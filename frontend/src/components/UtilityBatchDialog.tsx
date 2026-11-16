import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Droplets, Zap } from "lucide-react";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { UtilityOverview, UtilityRoomRow } from "../types";
import {
  currentPeriod,
  formatMoney,
  formatPeriod,
  inputToMilli,
  MAX_READING_LABEL,
  MAX_READING_MILLI,
  milliToInput,
  todayISO,
} from "../utils";
import { Button, EmptyState, Field, Modal } from "./UI";

interface BatchEntry {
  waterPrev: string;
  waterCurrent: string;
  electricityPrev: string;
  electricityCurrent: string;
}

function defaultReadingDate(period: string): string {
  if (period === currentPeriod()) return todayISO();
  const [year, month] = period.split("-").map(Number);
  return `${period}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
}

function rowKey(row: UtilityRoomRow): string {
  return `${row.property_id}-${row.floor || "none"}`;
}

function amountFrom(entry: BatchEntry, waterRate: number, electricityRate: number): number {
  const waterPrev = entry.waterPrev === "" ? null : inputToMilli(entry.waterPrev);
  const waterCurrent = inputToMilli(entry.waterCurrent);
  const electricityPrev = entry.electricityPrev === "" ? null : inputToMilli(entry.electricityPrev);
  const electricityCurrent = inputToMilli(entry.electricityCurrent);
  const waterUsage =
    waterPrev != null && waterCurrent != null && waterCurrent >= waterPrev
      ? waterCurrent - waterPrev
      : 0;
  const electricityUsage =
    electricityPrev != null && electricityCurrent != null && electricityCurrent >= electricityPrev
      ? electricityCurrent - electricityPrev
      : 0;
  return (
    Math.floor((waterUsage * waterRate + 500) / 1000) +
    Math.floor((electricityUsage * electricityRate + 500) / 1000)
  );
}

export function UtilityBatchDialog({
  open,
  data,
  onClose,
  onSaved,
}: {
  open: boolean;
  data: UtilityOverview;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<Record<number, BatchEntry>>({});
  const [readingDate, setReadingDate] = useState(todayISO());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const pendingRows = data.rooms.filter((row) => !row.record);
  const ratesConfigured = data.settings.water_rate_cents > 0 && data.settings.electricity_rate_cents > 0;

  useEffect(() => {
    if (!open) return;
    const next: Record<number, BatchEntry> = {};
    for (const row of pendingRows) {
      next[row.room_id] = {
        waterPrev: row.previous_editable ? "" : milliToInput(row.previous_water_milli),
        waterCurrent: "",
        electricityPrev: row.previous_editable ? "" : milliToInput(row.previous_electricity_milli),
        electricityCurrent: "",
      };
    }
    setEntries(next);
    setReadingDate(defaultReadingDate(data.period));
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data.period, data.rooms.length]);

  const updateEntry = (roomId: number, key: keyof BatchEntry, value: string) => {
    setEntries((current) => ({
      ...current,
      [roomId]: { ...current[roomId], [key]: value },
    }));
  };

  const fillFromPrevious = () => {
    setEntries((current) => {
      const next: Record<number, BatchEntry> = {};
      for (const row of pendingRows) {
        const entry = current[row.room_id] || {
          waterPrev: "",
          waterCurrent: "",
          electricityPrev: "",
          electricityCurrent: "",
        };
        next[row.room_id] = {
          ...entry,
          waterCurrent: entry.waterPrev,
          electricityCurrent: entry.electricityPrev,
        };
      }
      return next;
    });
  };

  const filledRows = pendingRows.filter((row) => {
    const entry = entries[row.room_id];
    return Boolean(entry?.waterCurrent.trim() && entry?.electricityCurrent.trim());
  });

  const partiallyFilledRows = pendingRows.filter((row) => {
    const entry = entries[row.room_id];
    if (!entry) return false;
    const water = Boolean(entry.waterCurrent.trim());
    const electricity = Boolean(entry.electricityCurrent.trim());
    return water !== electricity;
  });

  const estimatedTotal = filledRows.reduce((total, row) => {
    const entry = entries[row.room_id];
    if (!entry) return total;
    return total + amountFrom(entry, data.settings.water_rate_cents, data.settings.electricity_rate_cents);
  }, 0);

  const groups: { key: string; propertyName: string; floor: string; rows: UtilityRoomRow[] }[] = [];
  for (const row of pendingRows) {
    const key = rowKey(row);
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = { key, propertyName: row.property_name, floor: row.floor || "未填楼层", rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!ratesConfigured) {
      setError("请先在页面中设置水电默认单价，再使用批量抄表");
      return;
    }
    if (!filledRows.length) {
      setError("请至少完整填写一间房的水表和电表本期读数");
      return;
    }
    if (partiallyFilledRows.length) {
      setError(
        `请完整填写水表和电表读数：${partiallyFilledRows.map((row) => row.room_name).join("、")}`,
      );
      return;
    }
    const items = [];
    for (const row of filledRows) {
      const entry = entries[row.room_id];
      if (
        row.previous_editable &&
        (!entry.waterPrev.trim() || !entry.electricityPrev.trim())
      ) {
        setError(`${row.room_name} 是首次抄表，请填写水表和电表的起始读数`);
        return;
      }
      const waterPrev = entry.waterPrev === "" ? null : inputToMilli(entry.waterPrev);
      const waterCurrent = inputToMilli(entry.waterCurrent);
      const electricityPrev = entry.electricityPrev === "" ? null : inputToMilli(entry.electricityPrev);
      const electricityCurrent = inputToMilli(entry.electricityCurrent);
      if (
        waterPrev == null ||
        waterCurrent == null ||
        electricityPrev == null ||
        electricityCurrent == null
      ) {
        setError(`${row.room_name} 的读数格式不正确，请填写数字`);
        return;
      }
      if (
        waterPrev > MAX_READING_MILLI ||
        waterCurrent > MAX_READING_MILLI
      ) {
        setError(`${row.room_name} 的水表读数不能超过 ${MAX_READING_LABEL}`);
        return;
      }
      if (
        electricityPrev > MAX_READING_MILLI ||
        electricityCurrent > MAX_READING_MILLI
      ) {
        setError(`${row.room_name} 的电表读数不能超过 ${MAX_READING_LABEL}`);
        return;
      }
      if (waterCurrent < waterPrev) {
        setError(`${row.room_name} 的水表本期读数小于上期，请单独录入并勾选换表`);
        return;
      }
      if (electricityCurrent < electricityPrev) {
        setError(`${row.room_name} 的电表本期读数小于上期，请单独录入并勾选换表`);
        return;
      }
      items.push({
        room_id: row.room_id,
        water_prev_milli: waterPrev,
        water_current_milli: waterCurrent,
        electricity_prev_milli: electricityPrev,
        electricity_current_milli: electricityCurrent,
      });
    }
    setSaving(true);
    try {
      await api("/api/utilities/batch", {
        method: "POST",
        body: JSON.stringify({
          period: data.period,
          reading_date: readingDate,
          water_rate_cents: data.settings.water_rate_cents,
          electricity_rate_cents: data.settings.electricity_rate_cents,
          items,
        }),
      });
      toast(`已保存 ${items.length} 间房的水电记录`, "success");
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "批量保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="批量抄表"
      subtitle={`${formatPeriod(data.period)} · 仍有 ${pendingRows.length} 间未抄表`}
      width={980}
      footer={
        <>
          <span className="batch-footer-summary">
            已填写 <strong>{filledRows.length}</strong> 间 · 预计{" "}
            <strong>{formatMoney(estimatedTotal)}</strong>
          </span>
          <span className="modal-action-spacer" />
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            form="utility-batch-form"
            loading={saving}
            disabled={!filledRows.length || !ratesConfigured}
          >
            保存 {filledRows.length || ""} 间
          </Button>
        </>
      }
    >
      {!pendingRows.length ? (
        <EmptyState
          compact
          icon={<Droplets size={22} />}
          title="本月所有房间都已抄表"
          description="如需修改，请直接在台账中点击对应房间编辑。"
        />
      ) : (
        <form id="utility-batch-form" onSubmit={submit} className="stack-form">
          {!ratesConfigured && (
            <div className="form-callout warning">
              <AlertTriangle size={17} />
              <span>还没有设置默认单价，请先关闭窗口，在页面右上角设置水价和电价。</span>
            </div>
          )}
          <div className="batch-toolbar">
            <Field label="统一抄表日期" htmlFor="batch-reading-date">
              <input
                id="batch-reading-date"
                className="input"
                type="date"
                value={readingDate}
                onChange={(event) => setReadingDate(event.target.value)}
              />
            </Field>
            <div className="batch-toolbar-actions">
              <button type="button" className="text-link" onClick={fillFromPrevious}>
                全部带入上期读数
              </button>
              <span>水 {formatMoney(data.settings.water_rate_cents)}/吨 · 电 {formatMoney(data.settings.electricity_rate_cents)}/度</span>
            </div>
          </div>

          <div className="batch-table-wrap">
            <table className="batch-table">
              <thead>
                <tr>
                  <th>房间</th>
                  <th>
                    <span className="batch-th-icon water">
                      <Droplets size={12} /> 水表上期
                    </span>
                  </th>
                  <th>水表本期</th>
                  <th>
                    <span className="batch-th-icon power">
                      <Zap size={12} /> 电表上期
                    </span>
                  </th>
                  <th>电表本期</th>
                  <th>预计金额</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <FragmentRows
                    key={group.key}
                    group={group}
                    entries={entries}
                    updateEntry={updateEntry}
                    waterRate={data.settings.water_rate_cents}
                    electricityRate={data.settings.electricity_rate_cents}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {partiallyFilledRows.length > 0 && (
            <div className="form-callout warning">
              <AlertTriangle size={17} />
              <span>
                还有 {partiallyFilledRows.length} 间只填了一个表，保存前需要补齐水表和电表读数。
              </span>
            </div>
          )}
          {error && <div className="form-error-banner">{error}</div>}
        </form>
      )}
    </Modal>
  );
}

function FragmentRows({
  group,
  entries,
  updateEntry,
  waterRate,
  electricityRate,
}: {
  group: { key: string; propertyName: string; floor: string; rows: UtilityRoomRow[] };
  entries: Record<number, BatchEntry>;
  updateEntry: (roomId: number, key: keyof BatchEntry, value: string) => void;
  waterRate: number;
  electricityRate: number;
}) {
  return (
    <>
      <tr className="batch-floor-row">
        <td colSpan={6}>
          {group.propertyName} · {group.floor}
        </td>
      </tr>
      {group.rows.map((row) => {
        const entry = entries[row.room_id] || {
          waterPrev: "",
          waterCurrent: "",
          electricityPrev: "",
          electricityCurrent: "",
        };
        const amount = amountFrom(entry, waterRate, electricityRate);
        return (
          <tr key={row.room_id}>
            <td>
              <div className="batch-room">
                <strong>{row.room_name}</strong>
                <small>{row.tenant_name || "空置 · 房东"}</small>
              </div>
            </td>
            <td>
              {row.previous_editable ? (
                <input
                  className="batch-input"
                  type="text"
                  inputMode="decimal"
                  value={entry.waterPrev}
                  onChange={(event) => updateEntry(row.room_id, "waterPrev", event.target.value)}
                  placeholder="起始"
                  aria-label={`${row.room_name} 水表上期`}
                  maxLength={12}
                />
              ) : (
                <span className="batch-prev">{entry.waterPrev}</span>
              )}
            </td>
            <td>
              <input
                className="batch-input"
                type="text"
                inputMode="decimal"
                value={entry.waterCurrent}
                onChange={(event) => updateEntry(row.room_id, "waterCurrent", event.target.value)}
                placeholder="本期读数"
                aria-label={`${row.room_name} 水表本期`}
                maxLength={12}
              />
            </td>
            <td>
              {row.previous_editable ? (
                <input
                  className="batch-input"
                  type="text"
                  inputMode="decimal"
                  value={entry.electricityPrev}
                  onChange={(event) =>
                    updateEntry(row.room_id, "electricityPrev", event.target.value)
                  }
                  placeholder="起始"
                  aria-label={`${row.room_name} 电表上期`}
                  maxLength={12}
                />
              ) : (
                <span className="batch-prev">{entry.electricityPrev}</span>
              )}
            </td>
            <td>
              <input
                className="batch-input"
                type="text"
                inputMode="decimal"
                value={entry.electricityCurrent}
                onChange={(event) =>
                  updateEntry(row.room_id, "electricityCurrent", event.target.value)
                }
                placeholder="本期读数"
                aria-label={`${row.room_name} 电表本期`}
                maxLength={12}
              />
            </td>
            <td className="batch-amount">
              {entry.waterCurrent.trim() && entry.electricityCurrent.trim() ? formatMoney(amount) : "—"}
            </td>
          </tr>
        );
      })}
    </>
  );
}
