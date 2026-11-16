import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, IdCard, Plus, Search, Users } from "lucide-react";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { Tenant } from "../types";
import { leaseEndLabel, leaseStatusLabels } from "../utils";
import {
  Avatar,
  Button,
  EmptyState,
  LoadingBlock,
  PageHeader,
  StatusPill,
} from "../components/UI";

export function TenantsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isViewer = user?.role === "viewer";
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(Boolean(search.trim()));
      try {
        const result = await api<{ tenants: Tenant[] }>(
          `/api/tenants${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`,
        );
        if (active) setTenants(result.tenants);
      } catch (error) {
        if (active && !(error instanceof ApiError && error.status === 401)) {
          toast(error instanceof ApiError ? error.detail : "租客加载失败", "error");
        }
      } finally {
        if (active) {
          setLoading(false);
          setSearching(false);
        }
      }
    }, search ? 280 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, toast]);

  if (loading) return <LoadingBlock text="正在读取租客资料" />;

  return (
    <div className="page">
      <PageHeader
        eyebrow="RESIDENTS"
        title="租客"
        description="身份证照片在本地识别，列表中的证件号码默认脱敏显示。"
        actions={
          isViewer ? undefined : (
            <Button icon={<Plus size={17} />} onClick={() => navigate("/tenants/new")}>
              新增租客
            </Button>
          )
        }
      />

      <div className="toolbar">
        <div className="search-box">
          <Search size={17} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索姓名、手机号或身份证号"
            aria-label="搜索租客"
          />
          {searching && <span className="search-spinner" aria-label="搜索中" />}
        </div>
        <span className="toolbar-count">
          {search.trim() ? `找到 ${tenants.length} 位租客` : `共 ${tenants.length} 位租客`}
        </span>
      </div>

      {!tenants.length ? (
        <div className="panel">
          <EmptyState
            icon={<Users size={30} />}
            title={search.trim() ? "没有找到匹配的租客" : "还没有租客"}
            description={
              search.trim()
                ? "换一个姓名、手机号或证件号码试试。"
                : "录入租客时上传身份证人像面，系统会在本机自动识别姓名和证件号码。"
            }
            action={
              search.trim() ? (
                <Button variant="secondary" onClick={() => setSearch("")}>
                  清除搜索
                </Button>
              ) : isViewer ? undefined : (
                <Button onClick={() => navigate("/tenants/new")}>新增第一位租客</Button>
              )
            }
          />
        </div>
      ) : (
        <div className="table-panel">
          <table className="data-table tenant-table">
            <thead>
              <tr>
                <th>租客</th>
                <th>联系方式</th>
                <th>身份证号</th>
                <th>当前租住</th>
                <th>合同状态</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td data-label="租客">
                    <div className="person-cell">
                      <Avatar name={tenant.name} id={tenant.id} size="sm" />
                      <div>
                        <strong>{tenant.name}</strong>
                        <small>{tenant.gender || "未登记性别"}</small>
                      </div>
                    </div>
                  </td>
                  <td data-label="联系方式">
                    <span className={tenant.phone ? "cell-text" : "cell-muted"}>{tenant.phone || "未留电话"}</span>
                  </td>
                  <td data-label="身份证号">
                    <span className={tenant.id_number_masked ? "id-cell" : "cell-muted"}>
                      <IdCard size={14} />
                      {tenant.id_number_masked || "未登记"}
                    </span>
                  </td>
                  <td data-label="当前租住">
                    {tenant.active_lease ? (
                      <div className="cell-stack">
                        <strong>
                          {tenant.active_lease.property_name} · {tenant.active_lease.room_name}
                        </strong>
                        <small>至 {leaseEndLabel(tenant.active_lease.end_date)}</small>
                      </div>
                    ) : (
                      <span className="cell-muted">尚未签约</span>
                    )}
                  </td>
                  <td data-label="合同状态">
                    {tenant.active_lease ? (
                      <StatusPill
                        kind={tenant.active_lease.display_status}
                        label={leaseStatusLabels[tenant.active_lease.display_status]}
                      />
                    ) : (
                      <span className="status-pill status-muted">待签约</span>
                    )}
                  </td>
                  <td className="table-action-cell">
                    <button
                      type="button"
                      className="table-open"
                      onClick={() => navigate(`/tenants/${tenant.id}`)}
                      aria-label={`查看 ${tenant.name}`}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
