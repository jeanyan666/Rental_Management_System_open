import type { LeaseDisplayStatus, RentBill, RoomStatus } from "./types";

export const LONG_TERM_END_DATE = "2999-12-31";

export function isLongTermEnd(endDate: string | null | undefined): boolean {
  return endDate === LONG_TERM_END_DATE;
}

export function leaseEndLabel(endDate: string | null | undefined): string {
  return isLongTermEnd(endDate) ? "长期有效" : formatDate(endDate);
}

export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

export function billProrationLabel(bill: RentBill): string {
  if (bill.billing_cycle !== "anchor15") {
    return `${bill.days}/${bill.days_in_month} 天折算`;
  }
  const start = Date.parse(`${bill.period_start}T00:00:00`);
  const due = Date.parse(`${bill.due_date}T00:00:00`);
  const catchUpDays = Math.max(0, Math.round((due - start) / 86_400_000));
  if (catchUpDays > 0 && bill.period_end >= bill.due_date) {
    return `${catchUpDays} 天折算 + 整月`;
  }
  return `${bill.days} 天折算`;
}

export function formatMoney(cents: number, withSymbol = true): string {
  const amount = cents / 100;
  const formatted = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
  return withSymbol ? `¥ ${formatted}` : formatted;
}

export function centsToInput(cents: number): string {
  if (!cents) return "";
  return Number.isInteger(cents / 100) ? String(cents / 100) : (cents / 100).toFixed(2);
}

export function yuanToCents(value: string): number {
  const normalized = value.replace(/[,，\s]/g, "");
  if (!normalized) return 0;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100);
}

export function formatDate(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fallback;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function formatDateTime(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(
    date.getDate(),
  ).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(
    2,
    "0",
  )}`;
}

export function formatDateLong(value: string | Date): string {
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00`) : value;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatWeekday(value: Date): string {
  return `星期${"日一二三四五六"[value.getDay()]}`;
}

export function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function addYearsISO(value: string, years: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setFullYear(date.getFullYear() + years);
  date.setDate(date.getDate() - 1);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function initials(name: string): string {
  if (!name) return "?";
  return name.trim().slice(0, 1);
}

export const roomStatusLabels: Record<RoomStatus, string> = {
  vacant: "空置",
  occupied: "已租",
  maintenance: "维修中",
};

export const leaseStatusLabels: Record<LeaseDisplayStatus, string> = {
  active: "生效中",
  expiring: "即将到期",
  expired: "已到期",
  ended: "已结束",
};

export const rentStatusLabels: Record<"paid" | "unpaid" | "overdue" | "partial", string> = {
  paid: "已收",
  unpaid: "未收",
  overdue: "逾期",
  partial: "部分收款",
};

export const paymentMethodLabels: Record<string, string> = {
  wechat: "微信",
  alipay: "支付宝",
  bank: "银行转账",
  cash: "现金",
  other: "其他",
};

export function tenure(startDate: string | null | undefined, endDate: string | null | undefined): string {
  if (!startDate || !endDate) return "—";
  return `${formatDate(startDate)} — ${leaseEndLabel(endDate)}`;
}

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK_CODES = "10X98765432";

export function isValidIdNumber(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  if (!/^[1-9]\d{16}[\dX]$/.test(normalized)) return false;
  const year = Number(normalized.slice(6, 10));
  const month = Number(normalized.slice(10, 12));
  const day = Number(normalized.slice(12, 14));
  const birth = new Date(year, month - 1, day);
  if (
    Number.isNaN(birth.getTime()) ||
    birth.getFullYear() !== year ||
    birth.getMonth() !== month - 1 ||
    birth.getDate() !== day ||
    birth > new Date()
  ) {
    return false;
  }
  const sum = ID_WEIGHTS.reduce((total, weight, index) => total + Number(normalized[index]) * weight, 0);
  return normalized[17] === ID_CHECK_CODES[sum % 11];
}

export function idMeta(value: string): { gender: string | null; birthDate: string | null } {
  if (!isValidIdNumber(value)) return { gender: null, birthDate: null };
  const normalized = value.trim().toUpperCase();
  return {
    gender: Number(normalized[16]) % 2 === 1 ? "男" : "女",
    birthDate: `${normalized.slice(6, 10)}-${normalized.slice(10, 12)}-${normalized.slice(12, 14)}`,
  };
}

export function todayLong(): string {
  const now = new Date();
  return `${formatDateLong(now)} · ${formatWeekday(now)}`;
}

export const MAX_READING_MILLI = 10_000_000_000;
export const MAX_READING_LABEL = "10,000,000";

export function currentPeriod(): string {
  return todayISO().slice(0, 7);
}

export function formatPeriod(period: string): string {
  const [year, month] = period.split("-");
  return `${year}年${Number(month)}月`;
}

export function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function milliToInput(milli: number | null | undefined): string {
  if (milli == null) return "";
  const whole = Math.trunc(milli / 1000);
  const fraction = String(Math.abs(milli) % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function inputToMilli(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  if (!/^\d+(\.\d{0,3})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 1000 + Number((fraction + "000").slice(0, 3));
}

export function formatUsage(milli: number): string {
  return milliToInput(Math.max(0, milli));
}

