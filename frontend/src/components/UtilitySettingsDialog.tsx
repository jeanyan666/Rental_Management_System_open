import { useEffect, useState, type FormEvent } from "react";
import { Settings2 } from "lucide-react";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { UtilitySettings } from "../types";
import { centsToInput, yuanToCents } from "../utils";
import { Button, Field, Modal } from "./UI";

export function UtilitySettingsDialog({
  open,
  settings,
  onClose,
  onSaved,
}: {
  open: boolean;
  settings: UtilitySettings;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [waterRate, setWaterRate] = useState("");
  const [electricityRate, setElectricityRate] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setWaterRate(centsToInput(settings.water_rate_cents));
      setElectricityRate(centsToInput(settings.electricity_rate_cents));
      setError("");
    }
  }, [open, settings]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if ((waterRate && Number(waterRate) < 0) || (electricityRate && Number(electricityRate) < 0)) {
      setError("单价不能为负数");
      return;
    }
    setSaving(true);
    try {
      await api("/api/utilities/settings", {
        method: "PUT",
        body: JSON.stringify({
          water_rate_cents: yuanToCents(waterRate),
          electricity_rate_cents: yuanToCents(electricityRate),
        }),
      });
      toast("水电默认单价已更新", "success");
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="水电单价设置"
      subtitle="设置后，新建记录会自动带入这两个单价。"
      width={500}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="utility-settings-form" loading={saving}>
            保存设置
          </Button>
        </>
      }
    >
      <form id="utility-settings-form" onSubmit={submit} className="stack-form">
        <div className="utility-settings-intro">
          <span>
            <Settings2 size={17} />
          </span>
          <p>单价只影响保存后的新记录，不会重算已经保存的历史水电费。</p>
        </div>
        <div className="form-grid-2">
          <Field label="水费单价" htmlFor="water-rate" hint="元 / 吨">
            <input
              id="water-rate"
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={waterRate}
              onChange={(event) => setWaterRate(event.target.value)}
              placeholder="例如：5.00"
              autoFocus
            />
          </Field>
          <Field label="电费单价" htmlFor="electricity-rate" hint="元 / 度">
            <input
              id="electricity-rate"
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={electricityRate}
              onChange={(event) => setElectricityRate(event.target.value)}
              placeholder="例如：1.20"
            />
          </Field>
        </div>
        {error && <div className="form-error-banner">{error}</div>}
      </form>
    </Modal>
  );
}
