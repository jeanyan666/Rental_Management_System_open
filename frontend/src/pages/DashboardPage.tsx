import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  BellRing,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  DoorOpen,
  Plus,
  ScrollText,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { DashboardData, Property } from "../types";
import {
  formatMoney,
  leaseEndLabel,
  formatPeriod,
  greeting,
  leaseStatusLabels,
  roomStatusLabels,
  todayLong,
} from "../utils";
import { Avatar, Button, EmptyState, LoadingBlock, PageHeader, StatusPill } from "../components/UI";
import { RoomOverview } from "../components/RoomOverview";

export function DashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const isViewer = user?.role === "viewer";

  useEffect(() => {
    let active = true;
    Promise.all([
      api<DashboardData>("/api/dashboard"),
      api<{ properties: Property[] }>("/api/properties"),
    ])
      .then(([dashboardResult, propertyResult]) => {
        if (!active) return;
        setData(dashboardResult);
        setProperties(propertyResult.properties);
      })
      .catch((error) => {
        if (active && !(error instanceof ApiError && error.status === 401)) {
          toast(error instanceof ApiError ? error.detail : "概览加载失败", "error");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast]);

  if (loading) {
    return <LoadingBlock text="正在整理你的租务概览" />;
  }

  const stats = data?.stats;
  const occupancy = stats?.occupancy_rate ?? 0;

  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow={todayLong()}
        title={`${greeting()}，${user?.display_name || "房东"}`}
        description="房子有人住，合同有回应，日子就安稳。"
        actions={
          isViewer ? undefined : (
            <>
              <Button variant="secondary" icon={<Plus size={17} />} onClick={() => navigate("/tenants/new")}>
                新增租客
              </Button>
              <Button icon={<ScrollText size={17} />} onClick={() => navigate("/leases?new=1")}>
                新建合同
              </Button>
            </>
          )
        }
      />

      <section className="stat-grid" aria-label="经营概览">
        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-icon clay">
              <Building2 size={19} />
            </span>
            <span className="stat-label">已租房源</span>
          </div>
          <strong className="stat-value">
            {stats?.occupied_rooms ?? 0}
            <small> / {stats?.rooms ?? 0} 间</small>
          </strong>
          <p>{stats?.properties ?? 0} 处房屋正在管理</p>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-icon sage">
              <DoorOpen size={19} />
            </span>
            <span className="stat-label">空置房间</span>
          </div>
          <strong className="stat-value">
            {stats?.vacant_rooms ?? 0}
            <small> 间</small>
          </strong>
          <p>{stats?.maintenance_rooms ? `${stats.maintenance_rooms} 间维修中` : "暂无维修中的房间"}</p>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-icon sand">
              <Users size={19} />
            </span>
            <span className="stat-label">在册租客</span>
          </div>
          <strong className="stat-value">
            {stats?.tenants ?? 0}
            <small> 位</small>
          </strong>
          <p>{stats?.active_leases ?? 0} 份合同在租</p>
        </article>

        <article className={stats?.attention_leases ? "stat-card stat-alert" : "stat-card"}>
          <div className="stat-top">
            <span className="stat-icon amber">
              <BellRing size={19} />
            </span>
            <span className="stat-label">合同提醒</span>
          </div>
          <strong className="stat-value">
            {stats?.attention_leases ?? 0}
            <small> 份</small>
          </strong>
          <p>{stats?.attention_leases ? "含即将到期与已到期合同" : "未来 30 天没有到期合同"}</p>
        </article>
      </section>

      <section className="rent-strip">
        <div className="rent-strip-title">
          <span className="eyebrow">RENT COLLECTION</span>
          <h2>本月收租</h2>
          <p>
            {data?.rent.period ? formatPeriod(data.rent.period) : "本月"} ·{" "}
            {data?.rent.bills ?? 0} 张租金账单
          </p>
        </div>
        <div className="rent-strip-metrics">
          <div>
            <span>应收</span>
            <strong>{formatMoney(data?.rent.expected_cents ?? 0)}</strong>
          </div>
          <div>
            <span>已收</span>
            <strong>{formatMoney(data?.rent.received_cents ?? 0)}</strong>
          </div>
          <div>
            <span>未收</span>
            <strong>{formatMoney(data?.rent.outstanding_cents ?? 0)}</strong>
          </div>
          <div className={data?.rent.overdue_cents ? "rent-strip-overdue" : undefined}>
            <span>逾期</span>
            <strong>{formatMoney(data?.rent.overdue_cents ?? 0)}</strong>
          </div>
        </div>
        <button type="button" className="rent-strip-link" onClick={() => navigate("/rents")}>
          去收租 <ArrowUpRight size={15} />
        </button>
      </section>

      <RoomOverview properties={properties} />

      <section className="dashboard-grid">
        <article className="panel occupancy-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">OCCUPANCY</span>
              <h2>出租概况</h2>
            </div>
            <button type="button" className="text-link" onClick={() => navigate("/properties")}>
              查看房源 <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="occupancy-body">
            <div className="donut-wrap">
              <svg viewBox="0 0 120 120" className="donut" aria-label={`出租率 ${occupancy}%`}>
                <circle cx="60" cy="60" r="48" pathLength="100" className="donut-track" />
                <circle
                  cx="60"
                  cy="60"
                  r="48"
                  pathLength="100"
                  className="donut-value"
                  strokeDasharray={`${occupancy} 100`}
                />
              </svg>
              <div className="donut-center">
                <strong>{occupancy}%</strong>
                <span>出租率</span>
              </div>
            </div>
            <div className="occupancy-detail">
              <div className="occupancy-line">
                <span>
                  <i className="dot dot-clay" /> 已租
                </span>
                <strong>{stats?.occupied_rooms ?? 0} 间</strong>
              </div>
              <div className="occupancy-line">
                <span>
                  <i className="dot dot-sage" /> 空置
                </span>
                <strong>{stats?.vacant_rooms ?? 0} 间</strong>
              </div>
              <div className="occupancy-line">
                <span>
                  <i className="dot dot-sand" /> 维修
                </span>
                <strong>{stats?.maintenance_rooms ?? 0} 间</strong>
              </div>
              <div className="occupancy-total">
                <span>
                  <Wallet size={16} /> 在租合同月租金
                </span>
                <strong>{formatMoney(stats?.monthly_rent_cents ?? 0)}</strong>
              </div>
            </div>
          </div>
        </article>

        <article className="panel attention-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ATTENTION</span>
              <h2>需要关注</h2>
            </div>
            <button type="button" className="text-link" onClick={() => navigate("/leases")}>
              全部合同 <ChevronRight size={15} />
            </button>
          </div>
          {data?.attention_leases.length ? (
            <div className="attention-list">
              {data.attention_leases.map((lease) => (
                <button
                  type="button"
                  className="attention-item"
                  key={lease.id}
                  onClick={() => navigate("/leases")}
                >
                  <div className="attention-date">
                    <CalendarClock size={16} />
                    <span>{leaseEndLabel(lease.end_date)}</span>
                  </div>
                  <div className="attention-copy">
                    <strong>
                      {lease.tenant.name} · {lease.room.property_name} {lease.room.name}
                    </strong>
                    <span>
                      {lease.display_status === "expired"
                        ? `已到期 ${Math.abs(lease.days_left ?? 0)} 天`
                        : `${lease.days_left} 天后到期`}
                    </span>
                  </div>
                  <StatusPill kind={lease.display_status} label={leaseStatusLabels[lease.display_status]} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon={<Check size={22} />}
              title="暂时没有到期提醒"
              description="未来 30 天内的合同会出现在这里。"
            />
          )}
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">VACANT</span>
              <h2>待租房间</h2>
            </div>
            <button type="button" className="text-link" onClick={() => navigate("/properties")}>
              {isViewer ? "查看房源" : "管理房源"} <ChevronRight size={15} />
            </button>
          </div>
          {data?.vacant_rooms.length ? (
            <div className="compact-list">
              {data.vacant_rooms.map((room) => (
                <button
                  type="button"
                  key={room.id}
                  className="vacant-row"
                  onClick={() =>
                    navigate(isViewer ? "/properties" : `/leases?new=1&roomId=${room.id}`)
                  }
                >
                  <span className="room-glyph">
                    <DoorOpen size={17} />
                  </span>
                  <span className="compact-copy">
                    <strong>{room.name}</strong>
                    <small>
                      {room.property_name || ""} · {room.floor || "未填楼层"}
                    </small>
                  </span>
                  <span className="vacant-rent">{formatMoney(room.rent_cents)}<small>/月</small></span>
                  <StatusPill kind={room.status} label={roomStatusLabels[room.status]} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon={<DoorOpen size={22} />}
              title={stats?.rooms ? "所有房间都已租出" : "还没有添加房间"}
              description={stats?.rooms ? "保持得不错，记得关注合同到期。" : "先添加一处房屋和房间，再开始管理租客。"}
              action={
                isViewer ? undefined : (
                  <Button variant="secondary" size="sm" onClick={() => navigate("/properties")}>
                    去添加房源
                  </Button>
                )
              }
            />
          )}
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">RESIDENTS</span>
              <h2>最近新增租客</h2>
            </div>
            <button type="button" className="text-link" onClick={() => navigate("/tenants")}>
              全部租客 <ChevronRight size={15} />
            </button>
          </div>
          {data?.recent_tenants.length ? (
            <div className="compact-list">
              {data.recent_tenants.map((tenant) => (
                <button
                  type="button"
                  key={tenant.id}
                  className="tenant-row"
                  onClick={() => navigate(`/tenants/${tenant.id}`)}
                >
                  <Avatar name={tenant.name} id={tenant.id} size="sm" />
                  <span className="compact-copy">
                    <strong>{tenant.name}</strong>
                    <small>
                      {tenant.active_lease
                        ? `${tenant.active_lease.property_name} ${tenant.active_lease.room_name}`
                        : "尚未签约"}
                    </small>
                  </span>
                  <span className="compact-phone">{tenant.phone || "未留电话"}</span>
                  <ChevronRight size={16} className="row-chevron" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon={<Users size={22} />}
              title="还没有租客"
              description="新增租客时可以直接拍照识别身份证。"
              action={
                isViewer ? undefined : (
                  <Button variant="secondary" size="sm" onClick={() => navigate("/tenants/new")}>
                    新增第一位租客
                  </Button>
                )
              }
            />
          )}
        </article>
      </section>
    </div>
  );
}
