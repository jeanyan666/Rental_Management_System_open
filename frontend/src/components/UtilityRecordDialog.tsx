import { useEffect, useState, type FormEvent } from "react";
import { Droplets, Trash2, Zap } from "lucide-react";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { UtilityRoomRow, UtilitySettings } from "../types";
import {
  centsToInput,
  currentPeriod,
  formatMoney,
  formatPeriod,
  formatUsage,
  inputToMilli,
  MAX_READING_LABEL,
  MAX_READING_MILLI,
  milliToInput,
  todayISO,
  yuanToCents,
} from "../utils";
import { Button, ConfirmDialog, Field, Modal } from "./UI";

function defaultReadingDate(period: string): string {
  if (period === currentPeriod()) return todayISO();
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${period}-${String(lastDay).padStart(2, "0")}`;
}

function calculateUsage(current: number | null, previous: number | null, reset: boolean): number | null {
  if (current == null || previous == null) return null;
  if (current < previous) return reset ? current : null;
  return current - previous;
}

function calculateAmount(usage: number | null, rateCents: number): number {
  if (usage == null) return 0;
  return Math.floor((usage * rateCents + 500) / 1000);
}

export function UtilityRecordDialog({
  open,
  row,
  settings,
  period,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: UtilityRoomRow | null;
  settings: UtilitySettings;
  period: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const record = row?.record || null;
  const [readingDate, setReadingDate] = useState(todayISO());
  const [waterPrev, setWaterPrev] = useState("");
  const [waterCurrent, setWaterCurrent] = useState("");
  const [electricityPrev, setElectricityPrev] = useState("");
  const [electricityCurrent, setElectricityCurrent] = useState("");
  const [waterRate, setWaterRate] = useState("");
  const [electricityRate, setElectricityRate] = useState("");
  const [isPaid, setIsPaid] = useState(false);
  const [waterReset, setWaterReset] = useState(false);
  const [electricityReset, setElectricityReset] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    const existing = row.record;
    const previousEditable = !existing && row.previous_editable;
    setReadingDate(existing?.reading_date || defaultReadingDate(period));
    setWaterPrev(
      existing
        ? milliToInput(existing.water_prev_milli)
        : previousEditable
          ? ""
          : milliToInput(row.previous_water_milli),
    );
    setWaterCurrent(
      existing
        ? milliToInput(existing.water_current_milli)
        : previousEditable
          ? ""
          : milliToInput(row.previous_water_milli),
    );
    setElectricityPrev(
      existing
        ? milliToInput(existing.electricity_prev_milli)
        : previousEditable
          ? ""
          : milliToInput(row.previous_electricity_milli),
    );
    setElectricityCurrent(
      existing
        ? milliToInput(existing.electricity_current_milli)
        : previousEditable
          ? ""
          : milliToInput(row.previous_electricity_milli),
    );
    setWaterRate(centsToInput(existing?.water_rate_cents ?? row.water_rate_cents ?? settings.water_rate_cents));
    setElectricityRate(
      centsToInput(
        existing?.electricity_rate_cents ?? row.electricity_rate_cents ?? settings.electricity_rate_cents,
      ),
    );
    setIsPaid(existing?.is_paid || false);
    setWaterReset(existing?.water_reset || false);
    setElectricityReset(existing?.electricity_reset || false);
    setNote(existing?.note || "");
    setError("");
  }, [open, row, period, settings]);

  const previousEditable = !record && Boolean(row?.previous_editable);
  const waterPrevMilli = inputToMilli(waterPrev);
  const waterCurrentMilli = inputToMilli(waterCurrent);
  const electricityPrevMilli = inputToMilli(electricityPrev);
  const electricityCurrentMilli = inputToMilli(electricityCurrent);
  const waterUsage = calculateUsage(waterCurrentMilli, waterPrevMilli, waterReset);
  const electricityUsage = calculateUsage(electricityCurrentMilli, electricityPrevMilli, electricityReset);
  const waterRateCents = yuanToCents(waterRate);
  const electricityRateCents = yuanToCents(electricityRate);
  const waterAmount = calculateAmount(waterUsage, waterRateCents);
  const electricityAmount = calculateAmount(electricityUsage, electricityRateCents);
  const total = waterAmount + electricityAmount;
  const waterBelow = waterCurrentMilli != null && waterPrevMilli != null && waterCurrentMilli < waterPrevMilli;
  const electricityBelow =
    electricityCurrentMilli != null &&
    electricityPrevMilli != null &&
    electricityCurrentMilli < electricityPrevMilli;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!row) return;
    if (
      waterPrevMilli == null ||
      waterCurrentMilli == null ||
      electricityPrevMilli == null ||
      electricityCurrentMilli == null
    ) {
      setError("请填写完整的水表和电表读数");
      return;
    }
    if (waterPrevMilli > MAX_READING_MILLI || waterCurrentMilli > MAX_READING_MILLI) {
      setError(`水表读数不能超过 ${MAX_READING_LABEL}`);
      return;
    }
    if (electricityPrevMilli > MAX_READING_MILLI || electricityCurrentMilli > MAX_READING_MILLI) {
      setError(`电表读数不能超过 ${MAX_READING_LABEL}`);
      return;
    }
    if (waterBelow && !waterReset) {
      setError("水表本期读数小于上期，如已换表或清零，请勾选对应选项并填写备注");
      return;
    }
    if (electricityBelow && !electricityReset) {
      setError("电表本期读数小于上期，如已换表或清零，请勾选对应选项并填写备注");
      return;
    }
    if ((waterReset || electricityReset) && !note.trim()) {
      setError("勾选换表或清零后，请填写备注说明原因");
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      reading_date: readingDate,
      water_current_milli: waterCurrentMilli,
      electricity_current_milli: electricityCurrentMilli,
      water_rate_cents: waterRateCents,
      electricity_rate_cents: electricityRateCents,
      is_paid: isPaid,
      water_reset: waterReset,
      electricity_reset: electricityReset,
      note,
    };
    if (!record) {
      payload.room_id = row.room_id;
      payload.period = period;
      payload.water_prev_milli = waterPrevMilli;
      payload.electricity_prev_milli = electricityPrevMilli;
    }
    try {
      await api(record ? `/api/utilities/records/${record.id}` : "/api/utilities/records", {
        method: record ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      toast(record ? "水电记录已更新" : "水电记录已保存", "success");
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!record) return;
    setDeleting(true);
    try {
      await api(`/api/utilities/records/${record.id}`, { method: "DELETE" });
      toast("水电记录已删除", "success");
      setDeleteOpen(false);
      await onSaved();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "删除失败", "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal
        open={open && Boolean(row)}
        onClose={onClose}
        title={record ? "编辑水电记录" : "录入水电记录"}
        subtitle={
          row
            ? `${row.property_name} · ${row.floor || "未填楼层"} · ${row.room_name} ${
                row.tenant_name ? `· ${row.tenant_name}` : "· 空置"
              }`
            : undefined
        }
        width={720}
        footer={
          <>
            {record ? (
              <Button
                type="button"
                variant="ghost"
                className="danger-text"
                icon={<Trash2 size={15} />}
                onClick={() => setDeleteOpen(true)}
              >
                删除
              </Button>
            ) : null}
            <span className="modal-action-spacer" />
            <Button type="button" variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" form="utility-record-form" loading={saving}>
              {record ? "保存修改" : "保存记录"}
            </Button>
          </>
        }
      >
        <form id="utility-record-form" onSubmit={submit} className="stack-form">
          <div className="utility-record-meta">
            <Field label="抄表月份">
              <div className="input static-input">{formatPeriod(period)}</div>
            </Field>
            <Field label="抄表日期" htmlFor="utility-reading-date" required>
              <input
                id="utility-reading-date"
                className="input"
                type="date"
                value={readingDate}
                onChange={(event) => setReadingDate(event.target.value)}
              />
            </Field>
          </div>

          <div className="meter-form-grid">
            <section className="meter-form-card">
              <div className="meter-form-heading">
                <span className="meter-icon water">
                  <Droplets size={17} />
                </span>
                <div>
                  <strong>水表</strong>
                  <small>单位：吨 · 最大 {MAX_READING_LABEL}</small>
                </div>
              </div>
              <div className="form-grid-2">
                <Field
                  label="上期读数"
                  htmlFor="water-prev"
                  hint={previousEditable ? "首次录入，请填写起始读数" : undefined}
                >
                  <input
                    id="water-prev"
                    className="input meter-input"
                    type="text"
                    inputMode="decimal"
                    value={waterPrev}
                    onChange={(event) => setWaterPrev(event.target.value)}
                    disabled={!previousEditable}
                    placeholder="0.000"
                    maxLength={12}
                  />
                </Field>
                <Field label="本期读数" htmlFor="water-current" required>
                  <input
                    id="water-current"
                    className="input meter-input"
                    type="text"
                    inputMode="decimal"
                    value={waterCurrent}
                    onChange={(event) => setWaterCurrent(event.target.value)}
                    placeholder="请输入水表读数"
                    maxLength={12}
                  />
                </Field>
              </div>
              {waterBelow && (
                <label className="reset-check">
                  <input
                    type="checkbox"
                    checked={waterReset}
                    onChange={(event) => setWaterReset(event.target.checked)}
                  />
                  水表已换表或清零，本期读数从零开始
                </label>
              )}
              <div className="meter-rate-row">
                <Field label="水费单价（元/吨）" htmlFor="water-record-rate">
                  <input
                    id="water-record-rate"
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={waterRate}
                    onChange={(event) => setWaterRate(event.target.value)}
                    placeholder="0.00"
                  />
                </Field>
                <div className="meter-calc">
                  <span>用量 {waterUsage == null ? "—" : formatUsage(waterUsage)} 吨</span>
                  <strong>{formatMoney(waterAmount)}</strong>
                </div>
              </div>
            </section>

            <section className="meter-form-card">
              <div className="meter-form-heading">
                <span className="meter-icon power">
                  <Zap size={17} />
                </span>
                <div>
                  <strong>电表</strong>
                  <small>单位：度 · 最大 {MAX_READING_LABEL}</small>
                </div>
              </div>
              <div className="form-grid-2">
                <Field
                  label="上期读数"
                  htmlFor="electricity-prev"
                  hint={previousEditable ? "首次录入，请填写起始读数" : undefined}
                >
                  <input
                    id="electricity-prev"
                    className="input meter-input"
                    type="text"
                    inputMode="decimal"
                    value={electricityPrev}
                    onChange={(event) => setElectricityPrev(event.target.value)}
                    disabled={!previousEditable}
                    placeholder="0.000"
                    maxLength={12}
                  />
                </Field>
                <Field label="本期读数" htmlFor="electricity-current" required>
                  <input
                    id="electricity-current"
                    className="input meter-input"
                    type="text"
                    inputMode="decimal"
                    value={electricityCurrent}
                    onChange={(event) => setElectricityCurrent(event.target.value)}
                    placeholder="请输入电表读数"
                    maxLength={12}
                  />
                </Field>
              </div>
              {electricityBelow && (
                <label className="reset-check">
                  <input
                    type="checkbox"
                    checked={electricityReset}
                    onChange={(event) => setElectricityReset(event.target.checked)}
                  />
                  电表已换表或清零，本期读数从零开始
                </label>
              )}
              <div className="meter-rate-row">
                <Field label="电费单价（元/度）" htmlFor="electricity-record-rate">
                  <input
                    id="electricity-record-rate"
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={electricityRate}
                    onChange={(event) => setElectricityRate(event.target.value)}
                    placeholder="0.00"
                  />
                </Field>
                <div className="meter-calc">
                  <span>用量 {electricityUsage == null ? "—" : formatUsage(electricityUsage)} 度</span>
                  <strong>{formatMoney(electricityAmount)}</strong>
                </div>
              </div>
            </section>
          </div>

          <label className="switch-row">
            <input
              type="checkbox"
              checked={isPaid}
              onChange={(event) => setIsPaid(event.target.checked)}
            />
            <span className="switch-track">
              <span />
            </span>
            <span>
              <strong>这笔费用已收</strong>
              <small>保存时同步记录收款状态</small>
            </span>
          </label>

          <Field label="备注" htmlFor="utility-note">
            <textarea
              id="utility-note"
              className="input textarea"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="换表、读数异常或其他说明"
            />
          </Field>

          <div className="utility-total-preview">
            <span>本次水电合计</span>
            <strong>{formatMoney(total)}</strong>
          </div>

          {error && <div className="form-error-banner">{error}</div>}
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        title="删除这条水电记录？"
        description="删除后无法恢复。如果该房间已有后续月份记录，系统会拒绝删除。"
        confirmLabel="删除记录"
        danger
        loading={deleting}
      />
    </>
  );
}
