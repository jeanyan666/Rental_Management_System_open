import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  Droplets,
  Pencil,
  Plus,
  Search,
  Settings2,
  Wallet,
} from "lucide-react";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { UtilityOverview, UtilityRoomRow } from "../types";
import {
  currentPeriod,
  formatMoney,
  formatPeriod,
  formatUsage,
  milliToInput,
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
import { UtilitySettingsDialog } from "../components/UtilitySettingsDialog";
import { UtilityRecordDialog } from "../components/UtilityRecordDialog";
import { UtilityBatchDialog } from "../components/UtilityBatchDialog";
import { UtilityHistoryDialog } from "../components/UtilityHistoryDialog";

type UtilityFilter = "all" | "unrecorded" | "unpaid" | "paid";

function rowKey(row: UtilityRoomRow): string {
  return `${row.property_id}-${row.floor || "none"}`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv(data: UtilityOverview) {
  const headers = [
    "房屋",
    "楼层",
    "房间",
    "租客",
    "水表上期",
    "水表本期",
    "水用量(吨)",
    "水费(元)",
    "电表上期",
    "电表本期",
    "电用量(度)",
    "电费(元)",
    "合计(元)",
    "收款状态",
    "抄表日期",
    "备注",
  ];
  const rows = data.rooms.map((row) => {
    const record = row.record;
    return [
      row.property_name,
      row.floor,
      row.room_name,
      row.tenant_name,
      milliToInput(record?.water_prev_milli ?? row.previous_water_milli),
      record ? milliToInput(record.water_current_milli) : "",
      record ? formatUsage(record.water_usage_milli) : "",
      record ? (record.water_amount_cents / 100).toFixed(2) : "",
      milliToInput(record?.electricity_prev_milli ?? row.previous_electricity_milli),
      record ? milliToInput(record.electricity_current_milli) : "",
      record ? formatUsage(record.electricity_usage_milli) : "",
      record ? (record.electricity_amount_cents / 100).toFixed(2) : "",
      record ? (record.total_cents / 100).toFixed(2) : "",
      record ? (record.is_paid ? "已收" : "未收") : "未抄表",
      record?.reading_date || "",
      record?.note || "",
    ];
  });
  const csv = `\ufeff${[headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `水电明细_${data.period}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function UtilitiesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isViewer = user?.role === "viewer";
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<UtilityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<UtilityFilter>("all");
  const [search, setSearch] = useState("");
  const [recordRow, setRecordRow] = useState<UtilityRoomRow | null>(null);
  const [historyRow, setHistoryRow] = useState<UtilityRoomRow | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<UtilityRoomRow | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<UtilityOverview>(`/api/utilities?period=${period}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error) => {
        if (active && !(error instanceof ApiError && error.status === 401)) {
          toast(error instanceof ApiError ? error.detail : "水电记录加载失败", "error");
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
    const result = await api<UtilityOverview>(`/api/utilities?period=${period}`);
    setData(result);
  };

  const markPaid = async () => {
    if (!payTarget?.record) return;
    setPaying(true);
    try {
      await api(`/api/utilities/records/${payTarget.record.id}/paid`, {
        method: "POST",
        body: JSON.stringify({ is_paid: true }),
      });
      toast(`${payTarget.room_name} 已标记为已收`, "success");
      setPayTarget(null);
      await reload();
    } catch (error) {
      toast(error instanceof ApiError ? error.detail : "标记失败", "error");
    } finally {
      setPaying(false);
    }
  };

  if (loading) return <LoadingBlock text="正在读取水电台账" />;
  if (!data) {
    return (
      <div className="page">
        <EmptyState
          icon={<Droplets size={30} />}
          title="水电记录加载失败"
          description="请刷新页面重试。"
        />
      </div>
    );
  }

  const query = search.trim().toLowerCase();
  const filteredRows = data.rooms.filter((row) => {
    const record = row.record;
    if (filter === "unrecorded" && record) return false;
    if (filter === "unpaid" && (!record || record.is_paid)) return false;
    if (filter === "paid" && (!record || !record.is_paid)) return false;
    if (query && !`${row.room_name} ${row.tenant_name} ${row.property_name}`.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });

  const groups: { key: string; propertyName: string; floor: string; rows: UtilityRoomRow[] }[] = [];
  for (const row of filteredRows) {
    const key = rowKey(row);
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = {
        key,
        propertyName: row.property_name,
        floor: row.floor || "未填楼层",
        rows: [],
      };
      groups.push(group);
    }
    group.rows.push(row);
  }

  const floorTotals = new Map<string, { recorded: number; total: number }>();
  for (const row of data.rooms) {
    const key = rowKey(row);
    const current = floorTotals.get(key) || { recorded: 0, total: 0 };
    current.total += 1;
    if (row.record) current.recorded += 1;
    floorTotals.set(key, current);
  }

  const ratesConfigured = data.settings.water_rate_cents > 0 && data.settings.electricity_rate_cents > 0;
  const summary = data.summary;

  return (
    <div className="page utilities-page">
      <PageHeader
        eyebrow="WATER & POWER"
        title="水电"
        description="按月记录每间房的水电读数，自动计算用量与费用。"
        actions={
          isViewer ? undefined : (
            <>
              <Button
                variant="secondary"
                icon={<Settings2 size={16} />}
                onClick={() => setSettingsOpen(true)}
              >
                单价设置
              </Button>
              <Button icon={<Plus size={17} />} onClick={() => setBatchOpen(true)}>
                批量抄表
              </Button>
            </>
          )
        }
      />

      {!ratesConfigured && (
        <div className="utility-setup-banner">
          <span className="alert-icon">
            <AlertTriangle size={18} />
          </span>
          <div>
            <strong>还没有设置默认水电单价</strong>
            <p>先设置水费（元/吨）和电费（元/度），录入时会自动带入并计算金额。</p>
          </div>
          {!isViewer && (
            <Button size="sm" variant="secondary" onClick={() => setSettingsOpen(true)}>
              去设置
            </Button>
          )}
        </div>
      )}

      <section className="stat-grid utility-stat-grid">
        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-icon clay">
              <Droplets size={19} />
            </span>
            <span className="stat-label">本月水电合计</span>
          </div>
          <strong className="stat-value utility-stat-value">{formatMoney(summary.total_cents)}</strong>
          <p>
            水 {formatMoney(summary.water_total_cents)} · 电{" "}
            {formatMoney(summary.electricity_total_cents)}
          </p>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-icon sand">
              <Wallet size={19} />
            </span>
            <span className="stat-label">租客应收</span>
          </div>
          <strong className="stat-value utility-stat-value">
            {formatMoney(summary.tenant_receivable_cents)}
          </strong>
          <p>
            已收 {formatMoney(summary.paid_cents)} · {summary.paid_count} 笔
          </p>
        </article>

        <article className={summary.unpaid_cents ? "stat-card stat-alert" : "stat-card"}>
          <div className="stat-top">
            <span className="stat-icon amber">
              <BellRing size={19} />
            </span>
            <span className="stat-label">尚未收回</span>
          </div>
          <strong className="stat-value utility-stat-value">{formatMoney(summary.unpaid_cents)}</strong>
          <p>{summary.unpaid_count} 笔待收</p>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-icon sage">
              <ClipboardCheck size={19} />
            </span>
            <span className="stat-label">抄表进度</span>
          </div>
          <strong className="stat-value utility-stat-value utility-progress-value">
            {summary.recorded_rooms}
            <small> / {summary.total_rooms} 间</small>
          </strong>
          <p>
            {summary.unrecorded_rooms ? `还有 ${summary.unrecorded_rooms} 间未抄表` : "本月已全部抄表"}
          </p>
        </article>
      </section>

      <div className="utility-controls">
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
              aria-label="选择月份"
            />
          </label>
          <IconButton label="下个月" onClick={() => setPeriod(shiftPeriod(period, 1))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>

        {!isViewer && (
          <div className="utility-control-actions">
            <button
              type="button"
              className="text-link"
              onClick={() => exportCsv(data)}
              disabled={!data.rooms.length}
            >
              <Download size={14} /> 导出明细
            </button>
          </div>
        )}
      </div>

      <div className="filter-bar utility-filter-bar">
        <div className="segment-control" role="tablist" aria-label="水电记录筛选">
          {(
            [
              ["all", "全部", data.rooms.length],
              ["unrecorded", "未抄表", summary.unrecorded_rooms],
              ["unpaid", "未收", summary.unpaid_count],
              ["paid", "已收", summary.paid_count],
            ] as [UtilityFilter, string, number][]
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

        <div className="search-box utility-search">
          <Search size={17} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索房号或租客"
            aria-label="搜索房号或租客"
          />
        </div>
      </div>

      {!data.rooms.length ? (
        <div className="panel">
          <EmptyState
            icon={<Droplets size={30} />}
            title="当前月份没有需要抄表的房间"
            description="只有当月有在租租客的房间才会显示，空置房无需录入水电。"
            action={
              isViewer ? undefined : (
                <Button variant="secondary" onClick={() => navigate("/properties")}>
                  去添加房源
                </Button>
              )
            }
          />
        </div>
      ) : filteredRows.length ? (
        <div className="table-panel utility-table-panel">
          <table className="data-table utility-table">
            <thead>
              <tr>
                <th>房间 / 租客</th>
                <th>水表（吨）</th>
                <th>电表（度）</th>
                <th>合计</th>
                <th>收款</th>
                {!isViewer && <th aria-label="操作" />}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const totals = floorTotals.get(group.key) || {
                  recorded: 0,
                  total: group.rows.length,
                };
                return (
                  <Fragment key={group.key}>
                    <tr className="utility-floor-row">
                      <td colSpan={isViewer ? 5 : 6}>
                        <div>
                          <strong>
                            {group.propertyName} · {group.floor}
                          </strong>
                          <span>
                            已抄 {totals.recorded} / {totals.total} 间
                          </span>
                        </div>
                      </td>
                    </tr>
                    {group.rows.map((row) => {
                      const record = row.record;
                      return (
                        <tr key={row.room_id}>
                          <td data-label="房间">
                            <div className="utility-room-cell">
                              {record ? (
                                <button
                                  type="button"
                                  className="utility-room-button"
                                  onClick={() => setHistoryRow(row)}
                                  title="查看历史抄表"
                                >
                                  {row.room_name}
                                </button>
                              ) : (
                                <strong>{row.room_name}</strong>
                              )}
                              <small>
                                {row.tenant_name ||
                                  (row.room_status === "maintenance" ? "维修中" : "空置 · 房东")}
                              </small>
                              <span className="utility-floor-mobile">{row.floor}</span>
                            </div>
                          </td>
                          <td data-label="水表">
                            <div className="meter-detail-grid">
                              {record ? (
                                <>
                                  <div className="meter-detail-item">
                                    <small>上期数</small>
                                    <strong>{milliToInput(record.water_prev_milli)}</strong>
                                  </div>
                                  <div className="meter-detail-item">
                                    <small>本期数</small>
                                    <strong>{milliToInput(record.water_current_milli)}</strong>
                                  </div>
                                  <div className="meter-detail-item">
                                    <small>用量</small>
                                    <strong>{formatUsage(record.water_usage_milli)} 吨</strong>
                                  </div>
                                  <div className="meter-detail-item">
                                    <small>金额</small>
                                    <strong>{formatMoney(record.water_amount_cents)}</strong>
                                  </div>
                                  {record.water_reset && (
                                    <span className="meter-detail-reset">换表</span>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span className="meter-detail-empty">
                                    上期 {milliToInput(row.previous_water_milli)}
                                  </span>
                                  <small className="cell-muted">未抄表</small>
                                </>
                              )}
                            </div>
                          </td>
                          <td data-label="电表">
                            <div className="meter-detail-grid">
                              {record ? (
                                <>
                                  <div className="meter-detail-item">
                                    <small>上期数</small>
                                    <strong>{milliToInput(record.electricity_prev_milli)}</strong>
                                  </div>
                                  <div className="meter-detail-item">
                                    <small>本期数</small>
                                    <strong>{milliToInput(record.electricity_current_milli)}</strong>
                                  </div>
                                  <div className="meter-detail-item">
                                    <small>用量</small>
                                    <strong>{formatUsage(record.electricity_usage_milli)} 度</strong>
                                  </div>
                                  <div className="meter-detail-item">
                                    <small>金额</small>
                                    <strong>{formatMoney(record.electricity_amount_cents)}</strong>
                                  </div>
                                  {record.electricity_reset && (
                                    <span className="meter-detail-reset">换表</span>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span className="meter-detail-empty">
                                    上期 {milliToInput(row.previous_electricity_milli)}
                                  </span>
                                  <small className="cell-muted">未抄表</small>
                                </>
                              )}
                            </div>
                          </td>
                          <td data-label="合计">
                            <strong className="utility-total">
                              {record ? formatMoney(record.total_cents) : "—"}
                            </strong>
                          </td>
                          <td data-label="收款">
                            {!record ? (
                              <span className="utility-pay utility-pay-none">未抄表</span>
                            ) : record.is_paid ? (
                              <span className="utility-pay utility-pay-paid">
                                <CheckMark /> 已收
                              </span>
                            ) : isViewer ? (
                              <span className="utility-pay utility-pay-unpaid">未收</span>
                            ) : (
                              <button
                                type="button"
                                className="utility-pay utility-pay-unpaid"
                                onClick={() => setPayTarget(row)}
                                title="点击标记为已收"
                              >
                                未收
                              </button>
                            )}
                          </td>
                          {!isViewer && (
                            <td className="table-action-cell">
                              <button
                                type="button"
                                className="text-button accent utility-edit-button"
                                onClick={() => setRecordRow(row)}
                              >
                                {record ? (
                                  <>
                                    <Pencil size={13} /> 编辑
                                  </>
                                ) : (
                                  "录入"
                                )}
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel utility-no-match">
          <p>没有符合当前条件的房间。</p>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setFilter("all");
              setSearch("");
            }}
          >
            清除筛选
          </button>
        </div>
      )}

      <p className="utility-footnote">
        水电记录独立保存，暂不会自动并入租金账单。仅当月有在租租客的房间需要抄表。
      </p>

      <UtilitySettingsDialog
        open={settingsOpen}
        settings={data.settings}
        onClose={() => setSettingsOpen(false)}
        onSaved={async () => {
          setSettingsOpen(false);
          await reload();
        }}
      />

      <UtilityRecordDialog
        open={Boolean(recordRow)}
        row={recordRow}
        settings={data.settings}
        period={period}
        onClose={() => setRecordRow(null)}
        onSaved={async () => {
          setRecordRow(null);
          await reload();
        }}
      />

      <UtilityBatchDialog
        open={batchOpen}
        data={data}
        onClose={() => setBatchOpen(false)}
        onSaved={async () => {
          setBatchOpen(false);
          await reload();
        }}
      />

      <UtilityHistoryDialog
        room={historyRow}
        onClose={() => setHistoryRow(null)}
      />

      <ConfirmDialog
        open={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        onConfirm={markPaid}
        title="确认已收这笔水电费？"
        description={
          payTarget?.record
            ? `${payTarget.property_name} ${payTarget.room_name}，${payTarget.tenant_name || "租客"}，金额 ${formatMoney(
                payTarget.record.total_cents,
              )}。确认后会标记为已收。`
            : ""
        }
        confirmLabel="确认已收"
        loading={paying}
      />
    </div>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
      <path d="m2 6 2.4 2.4L10 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
