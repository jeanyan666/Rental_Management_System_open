import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  ChevronRight,
  FilePlus2,
  Plus,
  ScrollText,
} from "lucide-react";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { Lease, Property, Tenant, TerminationSettlement } from "../types";
import {
  addYearsISO,
  centsToInput,
  formatDate,
  formatMoney,
  isLongTermEnd,
  leaseEndLabel,
  leaseStatusLabels,
  todayISO,
  yuanToCents,
} from "../utils";
import {
  Avatar,
  Button,
  EmptyState,
  Field,
  LoadingBlock,
  Modal,
  PageHeader,
  StatusPill,
} from "../components/UI";

type Filter = "all" | "active" | "ended";

interface LeaseSummary {
  all: number;
  active: number;
  ended: number;
  attention: number;
}

export function LeasesPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isViewer = user?.role === "viewer";
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all");
  const [leases, setLeases] = useState<Lease[]>([]);
  const [summary, setSummary] = useState<LeaseSummary>({ all: 0, active: 0, ended: 0, attention: 0 });
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [terminateTarget, setTerminateTarget] = useState<Lease | null>(null);
  const [dueDayTarget, setDueDayTarget] = useState<Lease | null>(null);

  const load = useCallback(
    async (nextFilter = filter) => {
      try {
        const result = await api<{ leases: Lease[]; summary: LeaseSummary }>(
          `/api/leases?status_filter=${nextFilter}`,
        );
        setLeases(result.leases);
        setSummary(result.summary);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) {
          toast(error instanceof ApiError ? error.detail : "合同加载失败", "error");
        }
      } finally {
        setLoading(false);
      }
    },
    [filter, toast],
  );

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  useEffect(() => {
    if (!isViewer && searchParams.get("new") === "1") {
      setDialogOpen(true);
    }
  }, [searchParams, isViewer]);

  const closeDialog = () => {
    setDialogOpen(false);
    if (searchParams.has("new") || searchParams.has("tenantId") || searchParams.has("roomId")) {
      setSearchParams({}, { replace: true });
    }
  };

  const initialTenantId = Number(searchParams.get("tenantId") || 0) || null;
  const initialRoomId = Number(searchParams.get("roomId") || 0) || null;

  if (loading) return <LoadingBlock text="正在整理合同" />;

  return (
    <div className="page">
      <PageHeader
        eyebrow="LEASES"
        title="合同"
        description="一份合同对应一位租客和一个房间；房间状态会随合同自动变化。"
        actions={
          isViewer ? undefined : (
            <Button icon={<Plus size={17} />} onClick={() => setDialogOpen(true)}>
              新建合同
            </Button>
          )
        }
      />

      {summary.attention > 0 && (
        <div className="lease-alert-banner">
          <span className="alert-icon">
            <BellRing size={18} />
          </span>
          <div>
            <strong>{summary.attention} 份合同需要关注</strong>
            <p>包含即将到期和已经到期但尚未办理退租的合同。</p>
          </div>
          <button type="button" className="text-link" onClick={() => setFilter("active")}>
            查看生效合同 <ChevronRight size={15} />
          </button>
        </div>
      )}

      <div className="filter-bar">
        <div className="segment-control" role="tablist" aria-label="合同筛选">
          {(
            [
              ["all", "全部", summary.all],
              ["active", "生效中", summary.active],
              ["ended", "已结束", summary.ended],
            ] as [Filter, string, number][]
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? "segment active" : "segment"}
              onClick={() => setFilter(value)}
            >
              {label}
              <span>{count}</span>
            </button>
          ))}
        </div>
        <span className="toolbar-count">共 {summary.all} 份合同</span>
      </div>

      {!leases.length ? (
        <div className="panel">
          <EmptyState
            icon={<ScrollText size={30} />}
            title={filter === "all" ? "还没有合同" : "这个分类下没有合同"}
            description={
              filter === "all"
                ? "创建合同后，房间会自动标记为已租，并开始计算到期时间。"
                : "切换其他分类，或新建一份合同。"
            }
            action={
              filter === "all" ? (
                isViewer ? undefined : (
                  <Button onClick={() => setDialogOpen(true)}>新建第一份合同</Button>
                )
              ) : (
                <Button variant="secondary" onClick={() => setFilter("all")}>
                  查看全部
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="table-panel">
          <table className="data-table lease-table">
            <thead>
              <tr>
                <th>租客</th>
                <th>房间</th>
                <th>租期</th>
                <th>租金 / 押金</th>
                <th>状态</th>
                {!isViewer && <th aria-label="操作" />}
              </tr>
            </thead>
            <tbody>
              {leases.map((lease) => (
                <tr key={lease.id} className={lease.display_status === "expired" ? "row-attention" : undefined}>
                  <td data-label="租客">
                    <button
                      type="button"
                      className="person-cell as-button"
                      onClick={() => navigate(`/tenants/${lease.tenant.id}`)}
                    >
                      <Avatar name={lease.tenant.name} id={lease.tenant.id} size="sm" />
                      <div>
                        <strong>{lease.tenant.name}</strong>
                        <small>{lease.tenant.phone || "未留电话"}</small>
                      </div>
                    </button>
                  </td>
                  <td data-label="房间">
                    <div className="cell-stack">
                      <strong>{lease.room.name}</strong>
                      <small>{lease.room.property_name}</small>
                    </div>
                  </td>
                  <td data-label="租期">
                    <div className="cell-stack">
                      <strong>{formatDate(lease.start_date)}</strong>
                      <small>至 {leaseEndLabel(lease.end_date)}</small>
                    </div>
                  </td>
                  <td data-label="租金 / 押金">
                    <div className="cell-stack">
                      <strong>{formatMoney(lease.rent_cents)}</strong>
                      <small>押金 {formatMoney(lease.deposit_cents)}</small>
                    </div>
                  </td>
                  <td data-label="状态">
                    <div className="cell-stack">
                      <StatusPill
                        kind={lease.display_status}
                        label={leaseStatusLabels[lease.display_status]}
                      />
                      {lease.display_status === "expired" && (
                        <small className="expired-copy">
                          已超期 {Math.abs(lease.days_left ?? 0)} 天
                        </small>
                      )}
                      {lease.display_status === "expiring" &&
                        !isLongTermEnd(lease.end_date) && (
                          <small className="expiring-copy">{lease.days_left} 天后到期</small>
                        )}
                      <small className="lease-due-day">每月 {lease.rent_due_day || 1} 日收租</small>
                    </div>
                  </td>
                  {!isViewer && (
                    <td className="table-action-cell lease-action-cell">
                      <div className="lease-row-actions">
                      {lease.billing_cycle === "anchor15" ? (
                        <span className="cell-muted">固定 15 日</span>
                      ) : (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setDueDayTarget(lease)}
                        >
                          收租日
                        </button>
                      )}
                        {lease.status === "active" ? (
                          <button
                            type="button"
                            className="text-button accent"
                            onClick={() => setTerminateTarget(lease)}
                          >
                            退租
                          </button>
                        ) : (
                          <span className="cell-muted">已归档</span>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LeaseDialog
        open={dialogOpen}
        initialTenantId={initialTenantId}
        initialRoomId={initialRoomId}
        onClose={closeDialog}
        onSaved={async () => {
          closeDialog();
          setFilter("all");
          await load("all");
        }}
      />

      <TerminateDialog
        lease={terminateTarget}
        onClose={() => setTerminateTarget(null)}
        onSaved={async () => {
          setTerminateTarget(null);
          await load();
        }}
      />

      <DueDayDialog
        lease={dueDayTarget}
        onClose={() => setDueDayTarget(null)}
        onSaved={async () => {
          setDueDayTarget(null);
          await load();
        }}
      />
    </div>
  );
}

function LeaseDialog({
  open,
  initialTenantId,
  initialRoomId,
  onClose,
  onSaved,
}: {
  open: boolean;
  initialTenantId: number | null;
  initialRoomId: number | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(addYearsISO(todayISO(), 1));
  const [rent, setRent] = useState("");
  const [deposit, setDeposit] = useState("");
  const [signedDate, setSignedDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTenantId(initialTenantId ? String(initialTenantId) : "");
    setRoomId(initialRoomId ? String(initialRoomId) : "");
    setStartDate(todayISO());
    setEndDate("2999-12-31");
    setSignedDate(todayISO());
    setRent("");
    setDeposit("");
    setNote("");
    setError("");
    setLoadingOptions(true);
    Promise.all([
      api<{ tenants: Tenant[] }>("/api/tenants"),
      api<{ properties: Property[] }>("/api/properties"),
    ])
      .then(([tenantResult, propertyResult]) => {
        setTenants(tenantResult.tenants);
        setProperties(propertyResult.properties);
        if (initialRoomId) {
          const allRooms = propertyResult.properties.flatMap((property) => property.rooms);
          const room = allRooms.find((item) => item.id === initialRoomId);
          if (room) {
            setRent(centsToInput(room.rent_cents));
            setDeposit(centsToInput(room.rent_cents));
          }
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.detail : "选项加载失败"))
      .finally(() => setLoadingOptions(false));
  }, [open, initialTenantId, initialRoomId]);

  const vacantRooms = properties.flatMap((property) =>
    property.rooms
      .filter((room) => room.status === "vacant")
      .map((room) => ({ room, propertyName: property.name })),
  );

  const selectRoom = (value: string) => {
    setRoomId(value);
    const selected = vacantRooms.find((item) => String(item.room.id) === value);
    if (selected) {
      setRent(centsToInput(selected.room.rent_cents));
      setDeposit(centsToInput(selected.room.rent_cents));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!tenantId) {
      setError("请选择租客");
      return;
    }
    if (!roomId) {
      setError("请选择出租房间");
      return;
    }
    if (!startDate || !endDate) {
      setError("请填写合同起止日期");
      return;
    }
    if (endDate < startDate) {
      setError("结束日期不能早于开始日期");
      return;
    }
    setSaving(true);
    try {
      await api("/api/leases", {
        method: "POST",
        body: JSON.stringify({
          tenant_id: Number(tenantId),
          room_id: Number(roomId),
          start_date: startDate,
          end_date: endDate,
          rent_cents: yuanToCents(rent),
          deposit_cents: yuanToCents(deposit),
          rent_due_day: 15,
          signed_date: signedDate || null,
          note,
        }),
      });
      toast("合同已创建，首月租金已记微信收款", "success");
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "合同创建失败");
    } finally {
      setSaving(false);
    }
  };

  const availableTenants = tenants.filter((tenant) => !tenant.active_lease);
  const noRooms = vacantRooms.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建合同"
      subtitle="签约后房间状态会自动更新为已租。"
      width={640}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            form="lease-form"
            loading={saving}
            disabled={loadingOptions || noRooms || availableTenants.length === 0}
          >
            创建合同
          </Button>
        </>
      }
    >
      {loadingOptions ? (
        <LoadingBlock text="正在准备租客与房间" />
      ) : (
        <form id="lease-form" onSubmit={submit} className="stack-form">
          {availableTenants.length === 0 && (
            <div className="form-callout warning">
              <AlertTriangle size={17} />
              <span>暂无可签约的租客。请先新增租客，或为已有租客办理退租。</span>
            </div>
          )}
          {noRooms && (
            <div className="form-callout warning">
              <FilePlus2 size={17} />
              <span>暂无可出租的空置房间，请先在房源中添加或释放房间。</span>
            </div>
          )}

          <div className="form-grid-2">
            <Field label="租客" htmlFor="lease-tenant" required>
              <select
                id="lease-tenant"
                className="input select"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
              >
                <option value="">请选择租客</option>
                {availableTenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                    {tenant.phone ? ` · ${tenant.phone}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="出租房间" htmlFor="lease-room" required>
              <select
                id="lease-room"
                className="input select"
                value={roomId}
                onChange={(event) => selectRoom(event.target.value)}
              >
                <option value="">请选择空置房间</option>
                {vacantRooms.map((item) => (
                  <option key={item.room.id} value={item.room.id}>
                    {item.propertyName} · {item.room.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="form-grid-2">
            <Field label="开始日期" htmlFor="lease-start" required>
              <input
                id="lease-start"
                className="input"
                type="date"
                value={startDate}
                onChange={(event) => {
                  const next = event.target.value;
                  setStartDate(next);
                  if (next && (!endDate || endDate < next)) setEndDate(addYearsISO(next, 1));
                }}
              />
            </Field>
            <Field
              label="结束日期"
              htmlFor="lease-end"
              required
              hint="默认长期有效（2999-12-31），可手动修改"
            >
              <input
                id="lease-end"
                className="input"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
          </div>

          <div className="form-grid-2">
            <Field label="月租（元）" htmlFor="lease-rent" required>
              <input
                id="lease-rent"
                className="input"
                type="number"
                min="0"
                step="1"
                value={rent}
                onChange={(event) => setRent(event.target.value)}
                placeholder="例如：3200"
              />
            </Field>
            <Field label="押金（元）" htmlFor="lease-deposit">
              <input
                id="lease-deposit"
                className="input"
                type="number"
                min="0"
                step="1"
                value={deposit}
                onChange={(event) => setDeposit(event.target.value)}
                placeholder="例如：3200"
              />
            </Field>
          </div>

          <div className="form-grid-2">
            <Field label="签约日期" htmlFor="lease-signed">
              <input
                id="lease-signed"
                className="input"
                type="date"
                value={signedDate}
                onChange={(event) => setSignedDate(event.target.value)}
              />
            </Field>
            <Field label="每月收租日" htmlFor="lease-due-day-fixed">
              <input
                id="lease-due-day-fixed"
                className="input"
                value="每月 15 日"
                readOnly
              />
            </Field>
          </div>

          <div className="form-callout">
            <CalendarDays size={17} />
            <span>
              新合同固定每月 15 日收租。入住当天收取一个整月租金，按微信已收登记；首张 15
              日账单补齐至 15 日前的天数（如有），之后每月固定整月租金。
            </span>
          </div>

          <Field label="补充约定" htmlFor="lease-note">
            <textarea
              id="lease-note"
              className="input textarea"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：租金月付、押一付三、水电费用另计"
            />
          </Field>

          <div className="lease-form-preview">
            <CalendarDays size={16} />
            <span>
              {startDate && endDate
                ? `租期 ${formatDate(startDate)} — ${leaseEndLabel(endDate)}`
                : "请选择合同起止日期"}
            </span>
            <strong>{formatMoney(yuanToCents(rent))}<small>/月</small></strong>
          </div>

          {error && <div className="form-error-banner">{error}</div>}
        </form>
      )}
    </Modal>
  );
}

function TerminateDialog({
  lease,
  onClose,
  onSaved,
}: {
  lease: Lease | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [endDate, setEndDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lease) {
      setEndDate(todayISO());
      setNote("");
      setError("");
    }
  }, [lease]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!lease) return;
    if (endDate < lease.start_date) {
      setError("退租日期不能早于合同开始日期");
      return;
    }
    setSaving(true);
    try {
      const result = await api<{ settlement: TerminationSettlement | null }>(
        `/api/leases/${lease.id}/terminate`,
        {
          method: "POST",
          body: JSON.stringify({ end_date: endDate, note }),
        },
      );
      const refund = result.settlement?.refund_due_cents || 0;
      toast(
        refund
          ? `退租已办理，应退差额 ${formatMoney(refund)}，请线下退还`
          : "退租已办理，房间已转为空置",
        "success",
      );
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "退租失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(lease)}
      onClose={onClose}
      title="办理退租"
      subtitle={lease ? `${lease.tenant.name} · ${lease.room.property_name} ${lease.room.name}` : undefined}
      width={500}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="terminate-form" variant="danger" loading={saving}>
            确认退租
          </Button>
        </>
      }
    >
      <form id="terminate-form" onSubmit={submit} className="stack-form">
        <div className="form-callout warning">
          <AlertTriangle size={17} />
          <span>退租后合同将归档，房间自动转为空置。押金结算暂不在本版本内。</span>
        </div>
        <Field label="实际退租日期" htmlFor="terminate-date" required>
          <input
            id="terminate-date"
            className="input"
            type="date"
            value={endDate}
            min={lease?.start_date}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </Field>
        <Field label="退租备注" htmlFor="terminate-note">
          <textarea
            id="terminate-note"
            className="input textarea"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：正常退租、钥匙已归还"
          />
        </Field>
        {error && <div className="form-error-banner">{error}</div>}
      </form>
    </Modal>
  );
}

function DueDayDialog({
  lease,
  onClose,
  onSaved,
}: {
  lease: Lease | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [dueDay, setDueDay] = useState("1");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lease) {
      setDueDay(String(lease.rent_due_day || 1));
      setError("");
    }
  }, [lease]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!lease) return;
    const value = Number(dueDay);
    if (!Number.isInteger(value) || value < 1 || value > 31) {
      setError("收租日必须是 1–31 之间的整数");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/leases/${lease.id}/due-day`, {
        method: "PATCH",
        body: JSON.stringify({ rent_due_day: value }),
      });
      toast(`收租日已设置为每月 ${value} 日`, "success");
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(lease)}
      onClose={onClose}
      title="设置收租日"
      subtitle={lease ? `${lease.tenant.name} · ${lease.room.property_name} ${lease.room.name}` : undefined}
      width={460}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="due-day-form" loading={saving}>
            保存收租日
          </Button>
        </>
      }
    >
      <form id="due-day-form" onSubmit={submit} className="stack-form">
        <Field
          label="每月收租日"
          htmlFor="due-day-value"
          hint="当月没有该日期时，系统按当月最后一天计算。"
        >
          <div className="due-day-control">
            <input
              id="due-day-value"
              className="input"
              type="number"
              min="1"
              max="31"
              value={dueDay}
              onChange={(event) => setDueDay(event.target.value)}
              autoFocus
            />
            <span>日</span>
            <div className="due-day-quick">
              <button
                type="button"
                className={dueDay === "1" ? "active" : ""}
                onClick={() => setDueDay("1")}
              >
                1号
              </button>
              <button
                type="button"
                className={dueDay === "15" ? "active" : ""}
                onClick={() => setDueDay("15")}
              >
                15号
              </button>
            </div>
          </div>
        </Field>
        <div className="form-callout warning">
          <CalendarDays size={17} />
          <span>尚未收款的账单会同步更新到期日；已经收款的历史账单不会改变。</span>
        </div>
        {error && <div className="form-error-banner">{error}</div>}
      </form>
    </Modal>
  );
}
