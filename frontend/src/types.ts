export type UserRole = "super_admin" | "viewer" | "tenant";

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
  tenant_id: number | null;
  must_change_password: boolean;
  is_active: boolean;
}

export type RoomStatus = "vacant" | "occupied" | "maintenance";
export type LeaseDisplayStatus = "active" | "expiring" | "expired" | "ended";

export interface LeaseShort {
  id: number;
  tenant_id?: number;
  tenant_name?: string;
  room_id?: number;
  room_name?: string;
  property_name?: string;
  start_date?: string;
  end_date: string;
  display_status: LeaseDisplayStatus;
}

export interface Room {
  id: number;
  property_id: number;
  property_name: string;
  name: string;
  floor: string;
  area: number | null;
  rent_cents: number;
  status: RoomStatus;
  note: string;
  current_lease: LeaseShort | null;
}

export interface Property {
  id: number;
  name: string;
  address: string;
  note: string;
  rooms: Room[];
  room_count: number;
  occupied_count: number;
  vacant_count: number;
}

export interface Tenant {
  id: number;
  name: string;
  phone: string;
  id_number_masked: string | null;
  has_id_number: boolean;
  has_id_image: boolean;
  gender: string | null;
  birth_date: string | null;
  emergency_name: string;
  emergency_phone: string;
  note: string;
  created_at: string | null;
  active_lease: LeaseShort | null;
}

export interface Lease {
  id: number;
  tenant: { id: number; name: string; phone: string };
  room: { id: number; name: string; property_id: number; property_name: string };
  start_date: string;
  end_date: string;
  rent_cents: number;
  deposit_cents: number;
  rent_due_day: number;
  billing_cycle: "legacy" | "anchor15";
  signed_date: string | null;
  status: "active" | "ended";
  display_status: LeaseDisplayStatus;
  days_left: number | null;
  note: string;
  created_at: string | null;
}

export interface TenantDetail extends Tenant {
  leases: Lease[];
}

export interface TerminationSettlement {
  refund_due_cents: number;
  items: {
    bill_id: number;
    period: string;
    paid_cents: number;
    actual_cents: number;
    refund_cents: number;
  }[];
}

export type RentBillStatus = "paid" | "unpaid" | "overdue" | "partial";
export type PaymentMethod = "wechat" | "alipay" | "bank" | "cash" | "other";

export interface RentPayment {
  id: number;
  amount_cents: number;
  paid_on: string;
  method: PaymentMethod;
  note: string;
}

export interface RentBill {
  id: number;
  lease_id: number;
  period: string;
  billing_cycle: "legacy" | "anchor15";
  period_start: string;
  period_end: string;
  days: number;
  days_in_month: number;
  monthly_rent_cents: number;
  amount_cents: number;
  due_date: string;
  is_prorated: boolean;
  status: RentBillStatus;
  remaining_cents: number;
  days_overdue: number;
  tenant: { id: number | null; name: string };
  room: { id: number | null; name: string };
  property_name: string;
  payment: RentPayment | null;
  utility_exists: boolean;
  utility_total_cents: number;
  utility_paid: boolean;
  combined_total_cents: number;
  created_at: string | null;
}

export interface RentSummary {
  bills: number;
  expected_cents: number;
  received_cents: number;
  outstanding_cents: number;
  paid_count: number;
  unpaid_count: number;
  overdue_count: number;
  overdue_cents: number;
}

export interface RentOverview {
  period: string;
  bills: RentBill[];
  summary: RentSummary;
}

export interface DashboardData {
  today: string;
  stats: {
    properties: number;
    rooms: number;
    occupied_rooms: number;
    vacant_rooms: number;
    maintenance_rooms: number;
    tenants: number;
    active_leases: number;
    attention_leases: number;
    monthly_rent_cents: number;
    occupancy_rate: number;
  };
  attention_leases: Lease[];
  vacant_rooms: Room[];
  recent_tenants: Tenant[];
  rent: RentSummary & { period: string };
}

export interface OcrField {
  value: string;
  confidence: number;
  checksum_valid?: boolean;
}

export interface UtilitySettings {
  water_rate_cents: number;
  electricity_rate_cents: number;
}

export interface UtilityRecord {
  id: number;
  room_id: number;
  tenant_id: number | null;
  tenant_name: string;
  period: string;
  reading_date: string;
  water_prev_milli: number;
  water_current_milli: number;
  water_usage_milli: number;
  water_rate_cents: number;
  water_amount_cents: number;
  water_reset: boolean;
  electricity_prev_milli: number;
  electricity_current_milli: number;
  electricity_usage_milli: number;
  electricity_rate_cents: number;
  electricity_amount_cents: number;
  electricity_reset: boolean;
  is_paid: boolean;
  paid_at: string | null;
  total_cents: number;
  note: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface UtilityRoomRow {
  room_id: number;
  room_name: string;
  floor: string;
  room_status: RoomStatus;
  property_id: number;
  property_name: string;
  tenant_id: number | null;
  tenant_name: string;
  previous_water_milli: number;
  previous_electricity_milli: number;
  previous_editable: boolean;
  water_rate_cents: number;
  electricity_rate_cents: number;
  record: UtilityRecord | null;
}

export interface UtilitySummary {
  recorded_rooms: number;
  total_rooms: number;
  unrecorded_rooms: number;
  water_usage_milli: number;
  electricity_usage_milli: number;
  water_total_cents: number;
  electricity_total_cents: number;
  total_cents: number;
  tenant_receivable_cents: number;
  paid_count: number;
  unpaid_count: number;
  paid_cents: number;
  unpaid_cents: number;
}

export interface UtilityOverview {
  period: string;
  settings: UtilitySettings;
  summary: UtilitySummary;
  rooms: UtilityRoomRow[];
}

export interface UtilityHistory {
  room: {
    id: number;
    name: string;
    floor: string;
    property_name: string;
  };
  records: UtilityRecord[];
}

export interface TenantAccount {
  id: number;
  username: string;
  display_name: string;
  role: "tenant";
  tenant_id: number;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  tenant: {
    id: number;
    name: string;
    phone: string;
    id_number_masked: string | null;
  } | null;
  active_lease: {
    id: number;
    room_name: string;
    property_name: string;
    start_date: string;
    end_date: string;
  } | null;
}

export interface ViewerAccount {
  id: number;
  username: string;
  display_name: string;
  role: "viewer";
  tenant_id: null;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
}

export interface TenantPortalUtility {
  id: number;
  period: string;
  reading_date: string;
  room_name: string;
  property_name: string;
  water_prev_milli: number;
  water_current_milli: number;
  water_usage_milli: number;
  water_rate_cents: number;
  water_amount_cents: number;
  water_reset: boolean;
  electricity_prev_milli: number;
  electricity_current_milli: number;
  electricity_usage_milli: number;
  electricity_rate_cents: number;
  electricity_amount_cents: number;
  electricity_reset: boolean;
  total_cents: number;
  is_paid: boolean;
  paid_at: string | null;
  note: string;
}

export interface TenantPortalData {
  tenant: {
    id: number;
    name: string;
    phone: string;
    id_number_masked: string | null;
    gender: string | null;
    birth_date: string | null;
  };
  active_lease: {
    id: number;
    property_name: string;
    room_name: string;
    start_date: string;
    end_date: string;
    rent_cents: number;
    deposit_cents: number;
    rent_due_day: number;
    status: string;
  } | null;
  summary: {
    rent_expected_cents: number;
    rent_received_cents: number;
    rent_outstanding_cents: number;
    rent_overdue_cents: number;
    current_rent_cents: number;
    utility_unpaid_cents: number;
    utility_current_cents: number;
    current_payable_cents: number;
    current_unpaid_cents: number;
    current_payment_status: "paid" | "unpaid" | "none";
  };
  rent_bills: RentBill[];
  utilities: TenantPortalUtility[];
}

export interface OcrResult {
  ok: boolean;
  engine: string;
  token: string;
  name: OcrField | null;
  id_number: OcrField | null;
  gender: string | null;
  birth_date: string | null;
  raw_lines: { text: string; score: number }[];
  warnings: string[];
  error?: string;
}
