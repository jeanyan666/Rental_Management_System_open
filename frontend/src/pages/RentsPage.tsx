import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BadgeDollarSign,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Wallet,
} from "lucide-react";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { RentBill, RentOverview } from "../types";
import {
  billProrationLabel,
  currentPeriod,
  formatDate,
  formatMoney,
  formatPeriod,
  paymentMethodLabels,
  rentStatusLabels,
  shiftPeriod,
} from "../utils";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  LoadingBlock,
  PageHeader,
} from "../components/UI";
import { RentPaymentDialog } from "../components/RentPaymentDialog";

type RentFilter = "all" | "unpaid" | "paid" | "overdue";

export function RentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isViewer = user?.role === "viewer";
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<RentOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RentFilter>("all");
  const [payBill, setPayBill] = useState<RentBill | null>(null);
  const [undoBill, setUndoBill] = useState<RentBill | null>(null);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<RentOverview>(`/api/rents?period=${period}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error) => {
        if (active && !(error instanceof ApiError && error.status === 401)) {
          toast(error instanceof ApiError ? error.detail : "租金账单加载失败", "error");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [period, toast]);

  const reload = async () => {
    const result = await api<RentOverview>(`/api/rents?period=${period}`);
    setData(result);
  };

  const undoPayment = async () => {
    if (!undoBill?.payment) return;
    setUndoing(true);
    try {
      await api(`/api/rents/bills/${undoBill.id}/payment`, { method: "DELETE" });
      toast("收款记录已撤销", "success");
      setUndoBill(null);
      await reload();
    } catch (error) {
      toast(error instanceof ApiError ? error.detail : "撤销失败", "error");
    } finally {
      setUndoing(false);
    }
  };

  if (loading) return <LoadingBlock text="正在整理租金账单" />;
  if (!data) {
    return (
      <div className="page">
        <EmptyState
          icon={<Wallet size={30} />}
          title="租金账单加载失败"
          description="请刷新页面重试。"
        />
      </div>
    );
  }

  const bills = data.bills.filter((bill) => {
    if (filter === "paid") return bill.status === "paid";
    if (filter === "unpaid") return bill.status !== "paid";
    if (filter === "overdue") return bill.status === "overdue";
    return true;
  });
  const summary = data.summary;

  return (
    <div className="page rents-page">
      <PageHeader
        eyebrow="RENT COLLECTION"
        title="收租"
        description="按合同自动生成每月租金账单，记录实际交租日期与收款方式。"
        actions={
          <Button variant="secondary" onClick={() => navigate("/leases")}>
            查看合同
          </Button>
        }
      />

      <div className="utility-controls rent-controls">
        <div className="month-nav">
          <IconButton label="上个月" onClick={() => setPeriod(shiftPeriod(period, -1))}>
            <ChevronLeft size={18} />
          </IconButton>
          <label className="month-picker">
            <CalendarDays size={16} />
            <span>{formatPeriod(period)}</span>
            <input
              type="month"
              value={period}
              onChange={(event) => event.target.value && setPeriod(event.target.value)}
              aria-label="选择收租月份"
            />
          </label>
          <IconButton label="下个月" onClick={() => setPeriod(shiftPeriod(period, 1))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
        <span className="rent-generated-note">按合同自动生成 · 本期合计含租客水电</span>
      </div>

      <section className="stat-grid rent-stat-grid">
        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-icon sand">
              <BadgeDollarSign size={19} />
            </span>
            <span className="stat-label">本月应收</span>
          </div>
          <strong className="stat-value utility-stat-value">{formatMoney(summary.expected_cents)}</strong>
          <p>{summary.bills} 张租金账单</p>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-icon sage">
              <CircleCheck size={19} />
            </span>
            <span className="stat-label">已收租金</span>
          </div>
          <strong className="stat-value utility-stat-value">{formatMoney(summary.received_cents)}</strong>
          <p>{summary.paid_count} 张已收清</p>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-icon clay">
              <Wallet size={19} />
            </span>
            <span className="stat-label">尚未收回</span>
          </div>
          <strong className="stat-value utility-stat-value">{formatMoney(summary.outstanding_cents)}</strong>
          <p>{summary.unpaid_count} 张待收</p>
        </article>

        <article className={summary.overdue_count ? "stat-card stat-alert" : "stat-card"}>
          <div className="stat-top">
            <span className="stat-icon amber">
              <AlertTriangle size={19} />
            </span>
            <span className="stat-label">逾期未收</span>
          </div>
          <strong className="stat-value utility-stat-value">{formatMoney(summary.overdue_cents)}</strong>
          <p>{summary.overdue_count} 张账单已逾期</p>
        </article>
      </section>

      <div className="filter-bar rent-filter-bar">
        <div className="segment-control" role="tablist" aria-label="租金收款筛选">
          {(
            [
              ["all", "全部", summary.bills],
              ["unpaid", "未收", summary.unpaid_count],
              ["overdue", "逾期", summary.overdue_count],
              ["paid", "已收", summary.paid_count],
            ] as [RentFilter, string, number][]
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
      </div>

      {!data.bills.length ? (
        <div className="panel">
          <EmptyState
            icon={<Wallet size={30} />}
            title={`${formatPeriod(period)}没有租金账单`}
            description="只有当合同租期覆盖该月份时，系统才会生成租金账单。"
            action={
              <Button variant="secondary" onClick={() => navigate("/leases")}>
                查看合同
              </Button>
            }
          />
        </div>
      ) : !bills.length ? (
        <div className="panel utility-no-match">
          <p>当前筛选下没有租金账单。</p>
          <button type="button" className="text-link" onClick={() => setFilter("all")}>
            查看全部
          </button>
        </div>
      ) : (
        <div className="table-panel">
          <table className="data-table rent-table">
            <thead>
              <tr>
                <th>房间 / 租客</th>
                <th>账单周期</th>
                <th>本期租金</th>
                <th>本期水电</th>
                <th>本期合计</th>
                <th>租金状态</th>
                <th>实际交租</th>
                {!isViewer && <th aria-label="操作" />}
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => (
                <tr key={bill.id} className={bill.status === "overdue" ? "row-attention" : undefined}>
                  <td data-label="房间">
                    <div className="utility-room-cell">
                      <strong>{bill.room.name}</strong>
                      <small>{bill.tenant.name}</small>
                      <span className="utility-floor-mobile">{bill.property_name}</span>
                    </div>
                  </td>
                  <td data-label="账单周期">
                    <div className="cell-stack">
                      <strong>{formatPeriod(bill.period)}</strong>
                      <small>
                        {formatDate(bill.period_start)} — {formatDate(bill.period_end)}
                      </small>
                      {bill.is_prorated && (
                        <span className="rent-proration">
                          {billProrationLabel(bill)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td data-label="本期租金">
                    <div className="cell-stack">
                      <strong className="rent-amount">{formatMoney(bill.amount_cents)}</strong>
                      <small className={bill.status === "overdue" ? "expired-copy" : undefined}>
                        到期 {formatDate(bill.due_date)}
                        {bill.status === "overdue" ? ` · 逾期 ${bill.days_overdue} 天` : ""}
                      </small>
                    </div>
                  </td>
                  <td data-label="本期水电">
                    <div className="cell-stack">
                      <strong>{formatMoney(bill.utility_total_cents)}</strong>
                      <small>
                        {!bill.utility_exists
                          ? "未抄表"
                          : bill.utility_paid
                            ? "已收"
                            : "未收"}
                      </small>
                    </div>
                  </td>
                  <td data-label="本期合计">
                    <strong className="rent-amount">
                      {formatMoney(bill.combined_total_cents)}
                    </strong>
                  </td>
                  <td data-label="租金状态">
                    <span className={`rent-status rent-status-${bill.status}`}>
                      {rentStatusLabels[bill.status]}
                    </span>
                  </td>
                  <td data-label="实际交租">
                    {bill.payment ? (
                      <div className="cell-stack">
                        <strong>{formatDate(bill.payment.paid_on)}</strong>
                        <small>
                          {paymentMethodLabels[bill.payment.method] || bill.payment.method}
                          {bill.payment.note ? ` · ${bill.payment.note}` : ""}
                        </small>
                      </div>
                    ) : (
                      <span className="cell-muted">尚未交租</span>
                    )}
                  </td>
                  {!isViewer && (
                    <td className="table-action-cell rent-action-cell">
                      {bill.status === "paid" ? (
                        <button
                          type="button"
                          className="text-button rent-undo"
                          onClick={() => setUndoBill(bill)}
                        >
                          撤销
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-button accent"
                          onClick={() => setPayBill(bill)}
                        >
                          登记收款
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="utility-footnote">
        15 日计费合同：首张过渡账单补齐至 15 日前的天数并按天折算，之后每月 15 日至下月 14 日固定一个月租金；
        旧合同仍按自然月折算。每月账单只支持一次全额收款。
      </p>

      <RentPaymentDialog
        bill={payBill}
        onClose={() => setPayBill(null)}
        onSaved={async () => {
          setPayBill(null);
          await reload();
        }}
      />

      <ConfirmDialog
        open={Boolean(undoBill)}
        onClose={() => setUndoBill(null)}
        onConfirm={undoPayment}
        title="撤销这笔租金收款？"
        description={
          undoBill
            ? `${undoBill.property_name} ${undoBill.room.name} · ${formatPeriod(undoBill.period)}，金额 ${formatMoney(
                undoBill.amount_cents,
              )}。撤销后账单会恢复为未收。`
            : ""
        }
        confirmLabel="撤销收款"
        danger
        loading={undoing}
      />
    </div>
  );
}
