import { useEffect, useState } from "react";
import {
  BadgeDollarSign,
  CalendarDays,
  Droplets,
  Gift,
  Home,
  ReceiptText,
  Wallet,
  Zap,
} from "lucide-react";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import type { LeaseDisplayStatus, TenantPortalData } from "../types";
import {
  billProrationLabel,
  currentPeriod,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPeriod,
  formatUsage,
  leaseEndLabel,
  leaseStatusLabels,
  paymentMethodLabels,
  rentStatusLabels,
  shiftPeriod,
} from "../utils";
import { EmptyState, LoadingBlock, StatusPill } from "../components/UI";

export function TenantPortalPage() {
  const { user } = useAuth();
  const [data, setData] = useState<TenantPortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<TenantPortalData>("/api/tenant-portal/overview")
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof ApiError ? err.detail : "租务信息加载失败");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <LoadingBlock text="正在读取你的租务信息" />;
  if (!data) {
    return (
      <EmptyState
        icon={<Home size={28} />}
        title="暂时无法读取租务信息"
        description={error || "请稍后刷新重试。"}
      />
    );
  }

  const lease = data.active_lease;
  const summary = data.summary;
  const current = currentPeriod();
  const next = shiftPeriod(current, 1);
  const visibleRentBills = data.rent_bills
    .filter(
      (bill) =>
        bill.period === next ||
        (bill.period <= current && bill.status !== "paid"),
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  return (
    <div className="tenant-page">
      <header className="tenant-page-heading">
        <span className="eyebrow">MY RENTAL</span>
        <h1>你好，{data.tenant.name}</h1>
        <p>这里可以查看你的合同、租金账单和水电记录。</p>
      </header>

      <section className="tenant-referral-banner" aria-label="老租客推荐奖励">
        <div className="tenant-referral-icon">
          <Gift size={24} />
        </div>
        <div className="tenant-referral-copy">
          <span>老租客专享</span>
          <strong>推荐新租客成功入住</strong>
          <p>立即奖励现金大红包</p>
        </div>
      </section>

      {lease ? (
        <section className="tenant-lease-card">
          <div className="tenant-lease-icon">
            <Home size={24} />
          </div>
          <div className="tenant-lease-main">
            <div className="tenant-lease-title">
              <h2>
                {lease.property_name} · {lease.room_name}
              </h2>
              <StatusPill
                kind={(lease.status as LeaseDisplayStatus) || "active"}
                label={leaseStatusLabels[(lease.status as LeaseDisplayStatus) || "active"] || "在租"}
              />
            </div>
            <div className="tenant-lease-facts">
              <span>
                <CalendarDays size={14} /> {formatDate(lease.start_date)} —{" "}
                {leaseEndLabel(lease.end_date)}
              </span>
              <span>月租 {formatMoney(lease.rent_cents)}</span>
              <span>押金 {formatMoney(lease.deposit_cents)}</span>
              <span>每月 {lease.rent_due_day} 日交租</span>
            </div>
          </div>
        </section>
      ) : (
        <section className="tenant-lease-card tenant-lease-empty">
          <div className="tenant-lease-icon">
            <Home size={24} />
          </div>
          <div>
            <h2>当前没有生效中的合同</h2>
            <p>如有疑问，请联系房东核对。</p>
          </div>
        </section>
      )}

      <section className="tenant-stat-grid">
        <article>
          <span className="tenant-stat-icon sand">
            <BadgeDollarSign size={18} />
          </span>
          <div>
            <small>本期租金</small>
            <strong>{formatMoney(summary.current_rent_cents)}</strong>
          </div>
        </article>
        <article>
          <span className="tenant-stat-icon water">
            <Droplets size={18} />
          </span>
          <div>
            <small>本期水电费</small>
            <strong>{formatMoney(summary.utility_current_cents)}</strong>
          </div>
        </article>
        <article className="tenant-payable-card">
          <span className="tenant-stat-icon clay">
            <Wallet size={18} />
          </span>
          <div>
            <small>本期应付</small>
            <strong>{formatMoney(summary.current_payable_cents)}</strong>
            <span className={`tenant-payable-state ${summary.current_payment_status}`}>
              {summary.current_payment_status === "paid"
                ? "已缴清"
                : summary.current_payment_status === "unpaid"
                  ? `待缴 ${formatMoney(summary.current_unpaid_cents)}`
                  : "本期暂无账单"}
            </span>
          </div>
        </article>
      </section>

      <section className="panel tenant-history-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">RENT HISTORY</span>
            <h2>租金账单</h2>
          </div>
          <span className="tenant-section-note">
            待缴 + 下月 · {visibleRentBills.length} 条记录
          </span>
        </div>
        {visibleRentBills.length ? (
          <div className="table-panel tenant-table-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>月份</th>
                  <th>租期</th>
                  <th>应交</th>
                  <th>到期日</th>
                  <th>收款状态</th>
                  <th>实际交租</th>
                </tr>
              </thead>
              <tbody>
                {visibleRentBills.map((bill) => (
                  <tr key={bill.id}>
                    <td data-label="月份">
                      <div className="cell-stack">
                        <strong>{formatPeriod(bill.period)}</strong>
                        {bill.is_prorated && (
                          <span className="rent-proration">
                            {billProrationLabel(bill)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td data-label="租期">
                      {formatDate(bill.period_start)} — {formatDate(bill.period_end)}
                    </td>
                    <td data-label="应交">
                      <strong className="rent-amount">{formatMoney(bill.amount_cents)}</strong>
                    </td>
                    <td data-label="到期日">{formatDate(bill.due_date)}</td>
                    <td data-label="收款状态">
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
                          </small>
                        </div>
                      ) : (
                        <span className="cell-muted">尚未交租</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            compact
            icon={<ReceiptText size={22} />}
            title="暂无待缴租金"
            description="未缴租金和下月账单会显示在这里。"
          />
        )}
      </section>

      <section className="panel tenant-history-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">WATER & POWER</span>
            <h2>水电记录</h2>
          </div>
          <span className="tenant-section-note">
            近 2 个月 · {data.utilities.length} 条
          </span>
        </div>
        {data.utilities.length ? (
          <div className="table-panel tenant-table-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>月份</th>
                  <th>水表 / 水费</th>
                  <th>电表 / 电费</th>
                  <th>合计</th>
                  <th>缴纳状态</th>
                </tr>
              </thead>
              <tbody>
                {data.utilities.map((record) => (
                  <tr key={record.id}>
                    <td data-label="月份">
                      <div className="cell-stack">
                        <strong>{formatPeriod(record.period)}</strong>
                        <small>{formatDate(record.reading_date)} 抄表</small>
                        {record.note && <small>{record.note}</small>}
                      </div>
                    </td>
                    <td data-label="水表 / 水费">
                      <div className="tenant-utility-cell tenant-meter-cell">
                        <Droplets size={13} />
                        <div className="tenant-meter-grid">
                          <div className="tenant-meter-item">
                            <small>上期数</small>
                            <strong>{formatUsage(record.water_prev_milli)} 吨</strong>
                          </div>
                          <div className="tenant-meter-item">
                            <small>本期数</small>
                            <strong>{formatUsage(record.water_current_milli)} 吨</strong>
                          </div>
                          <div className="tenant-meter-item">
                            <small>用量</small>
                            <strong>{formatUsage(record.water_usage_milli)} 吨</strong>
                          </div>
                          <div className="tenant-meter-item">
                            <small>金额</small>
                            <strong>{formatMoney(record.water_amount_cents)}</strong>
                          </div>
                          {record.water_reset && (
                            <span className="tenant-meter-reset">换表</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-label="电表 / 电费">
                      <div className="tenant-utility-cell tenant-meter-cell">
                        <Zap size={13} />
                        <div className="tenant-meter-grid">
                          <div className="tenant-meter-item">
                            <small>上期数</small>
                            <strong>{formatUsage(record.electricity_prev_milli)} 度</strong>
                          </div>
                          <div className="tenant-meter-item">
                            <small>本期数</small>
                            <strong>{formatUsage(record.electricity_current_milli)} 度</strong>
                          </div>
                          <div className="tenant-meter-item">
                            <small>用量</small>
                            <strong>{formatUsage(record.electricity_usage_milli)} 度</strong>
                          </div>
                          <div className="tenant-meter-item">
                            <small>金额</small>
                            <strong>{formatMoney(record.electricity_amount_cents)}</strong>
                          </div>
                          {record.electricity_reset && (
                            <span className="tenant-meter-reset">换表</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-label="合计">
                      <strong className="utility-total">{formatMoney(record.total_cents)}</strong>
                    </td>
                    <td data-label="缴纳状态">
                      <div className="cell-stack tenant-pay-stack">
                        {record.is_paid ? (
                          <span className="utility-pay utility-pay-paid">已交</span>
                        ) : (
                          <span className="utility-pay utility-pay-unpaid">未交</span>
                        )}
                        {record.is_paid && record.paid_at && (
                          <small>{formatDateTime(record.paid_at)}</small>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            compact
            icon={<Droplets size={22} />}
            title="暂无水电记录"
            description="近 2 个月房东完成抄表后会显示在这里。"
          />
        )}
      </section>

      <p className="tenant-portal-footnote">
        {user?.display_name} · 账号 {user?.username} · 租金显示待缴与下月，水电显示近 2 个月
      </p>
    </div>
  );
}
