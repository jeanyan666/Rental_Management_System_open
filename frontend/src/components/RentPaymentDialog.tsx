import { useEffect, useState, type FormEvent } from "react";
import { CalendarCheck, Wallet } from "lucide-react";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { PaymentMethod, RentBill } from "../types";
import {
  formatDate,
  formatMoney,
  formatPeriod,
  paymentMethodLabels,
  todayISO,
} from "../utils";
import { Button, Field, Modal } from "./UI";

export function RentPaymentDialog({
  bill,
  onClose,
  onSaved,
}: {
  bill: RentBill | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [paidOn, setPaidOn] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>("wechat");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (bill) {
      setPaidOn(todayISO());
      setMethod("wechat");
      setNote("");
      setError("");
    }
  }, [bill]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!bill) return;
    setSaving(true);
    try {
      await api(`/api/rents/bills/${bill.id}/payment`, {
        method: "POST",
        body: JSON.stringify({ paid_on: paidOn, method, note }),
      });
      toast(`${bill.room.name} ${formatPeriod(bill.period)}租金已登记收款`, "success");
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "登记收款失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(bill)}
      onClose={onClose}
      title="登记租金收款"
      subtitle={bill ? `${bill.property_name} · ${bill.room.name} · ${bill.tenant.name}` : undefined}
      width={500}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="rent-payment-form" loading={saving}>
            确认收款
          </Button>
        </>
      }
    >
      {bill && (
        <form id="rent-payment-form" onSubmit={submit} className="stack-form">
          <div className="rent-payment-amount">
            <span>
              <Wallet size={18} /> 本期应收租金
            </span>
            <strong>{formatMoney(bill.amount_cents)}</strong>
            <small>
              {formatPeriod(bill.period)} · {formatDate(bill.period_start)} —{" "}
              {formatDate(bill.period_end)}
              {bill.is_prorated ? ` · 按 ${bill.days}/${bill.days_in_month} 天折算` : ""}
            </small>
          </div>

          <Field label="实际交租日期" htmlFor="rent-paid-on" required>
            <div className="input-with-icon">
              <CalendarCheck size={17} />
              <input
                id="rent-paid-on"
                className="input"
                type="date"
                value={paidOn}
                onChange={(event) => setPaidOn(event.target.value)}
                required
              />
            </div>
          </Field>

          <Field label="收款方式" htmlFor="rent-method">
            <select
              id="rent-method"
              className="input select"
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            >
              {Object.entries(paymentMethodLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="备注" htmlFor="rent-payment-note">
            <textarea
              id="rent-payment-note"
              className="input textarea"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：租客微信转账，已确认到账"
            />
          </Field>

          <div className="form-callout warning">
            <Wallet size={17} />
            <span>当前版本每张账单只支持登记一次全额收款。如登记错误，可撤销后重新录入。</span>
          </div>

          {error && <div className="form-error-banner">{error}</div>}
        </form>
      )}
    </Modal>
  );
}
