import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  IdCard,
  Phone,
  Plus,
  ScanLine,
  ScrollText,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { TenantDetail } from "../types";
import {
  formatDate,
  formatMoney,
  leaseStatusLabels,
  tenure,
} from "../utils";
import {
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  LoadingBlock,
  Modal,
  PageHeader,
  StatusPill,
} from "../components/UI";

export function TenantDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isViewer = user?.role === "viewer";
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    api<{ tenant: TenantDetail }>(`/api/tenants/${id}`)
      .then((result) => {
        if (active) setTenant(result.tenant);
      })
      .catch((error) => {
        if (!active) return;
        toast(error instanceof ApiError ? error.detail : "租客资料加载失败", "error");
        navigate("/tenants", { replace: true });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, navigate, toast]);

  const removeTenant = async () => {
    if (!tenant) return;
    setDeleting(true);
    try {
      await api(`/api/tenants/${tenant.id}`, { method: "DELETE" });
      toast("租客已删除", "success");
      navigate("/tenants", { replace: true });
    } catch (error) {
      toast(error instanceof ApiError ? error.detail : "删除失败", "error");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <LoadingBlock text="正在读取租客资料" />;
  if (!tenant) return null;

  const activeLease = tenant.leases.find((lease) => lease.status === "active") || null;
  const hasLeaseHistory = tenant.leases.length > 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="RESIDENT PROFILE"
        title={tenant.name}
        description={tenant.active_lease ? "当前有生效中的租约。" : "目前没有生效中的租约。"}
        back={
          <button type="button" className="back-link" onClick={() => navigate("/tenants")}>
            <ArrowLeft size={16} /> 返回租客列表
          </button>
        }
        actions={
          isViewer ? undefined : (
            <>
              {!activeLease && (
                <Button
                  variant="secondary"
                  icon={<Plus size={16} />}
                  onClick={() => navigate(`/leases?new=1&tenantId=${tenant.id}`)}
                >
                  创建合同
                </Button>
              )}
              <Button onClick={() => navigate(`/tenants/${tenant.id}/edit`)}>编辑资料</Button>
              <IconButton label="删除租客" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={17} />
              </IconButton>
            </>
          )
        }
      />

      <div className="tenant-detail-grid">
        <section className="panel profile-panel">
          <div className="profile-hero">
            <Avatar name={tenant.name} id={tenant.id} size="lg" />
            <div className="profile-title">
              <div className="profile-name-row">
                <h2>{tenant.name}</h2>
                {tenant.active_lease ? (
                  <StatusPill
                    kind={tenant.active_lease.display_status}
                    label={leaseStatusLabels[tenant.active_lease.display_status]}
                  />
                ) : (
                  <span className="status-pill status-muted">待签约</span>
                )}
              </div>
              <p>
                {tenant.phone ? (
                  <a href={`tel:${tenant.phone}`}>
                    <Phone size={14} /> {tenant.phone}
                  </a>
                ) : (
                  "未留联系电话"
                )}
              </p>
            </div>
          </div>

          <div className="profile-facts">
            <div>
              <span>性别</span>
              <strong>{tenant.gender || "未登记"}</strong>
            </div>
            <div>
              <span>出生日期</span>
              <strong>{tenant.birth_date ? formatDate(tenant.birth_date) : "未登记"}</strong>
            </div>
            <div>
              <span>身份证号</span>
              <strong className="masked-id">{tenant.id_number_masked || "未登记"}</strong>
            </div>
          </div>

          <div className="profile-section">
            <h3>
              <UserRound size={16} /> 紧急联系人
            </h3>
            {tenant.emergency_name || tenant.emergency_phone ? (
              <p>
                {tenant.emergency_name || "未填姓名"}
                {tenant.emergency_phone ? ` · ${tenant.emergency_phone}` : ""}
              </p>
            ) : (
              <p className="muted-copy">尚未填写紧急联系人</p>
            )}
          </div>

          <div className="profile-section">
            <h3>
              <ScrollText size={16} /> 备注
            </h3>
            <p className={tenant.note ? "profile-note" : "muted-copy"}>{tenant.note || "暂无备注"}</p>
          </div>
        </section>

        <section className="panel id-card-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ID DOCUMENT</span>
              <h2>身份证件</h2>
            </div>
            <span className="local-badge">
              <ShieldCheck size={14} /> 登录可见
            </span>
          </div>

          {tenant.has_id_image && !imageFailed ? (
            <button type="button" className="id-document" onClick={() => setImageOpen(true)}>
              <img
                src={`/api/tenants/${tenant.id}/id-image`}
                alt={`${tenant.name}的身份证照片`}
                onError={() => setImageFailed(true)}
              />
              <span>点击查看原图</span>
            </button>
          ) : (
            <div className="id-document-placeholder">
              <ScanLine size={26} />
              <strong>{tenant.has_id_image ? "证件照片暂时无法读取" : "尚未保存身份证照片"}</strong>
              <span>{isViewer ? "暂无证件照片" : "可在编辑资料时上传并识别"}</span>
            </div>
          )}

          <div className="id-card-meta">
            <div>
              <IdCard size={16} />
              <span>证件号码</span>
            </div>
            <strong>{tenant.id_number_masked || "未登记"}</strong>
          </div>
          <p className="privacy-note">
            <ShieldCheck size={15} />
            证件号码默认脱敏，原图仅登录后可查看。
          </p>
        </section>

        <section className="panel lease-history-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">LEASES</span>
              <h2>合同记录</h2>
            </div>
            {activeLease && (
              <span className="rent-highlight">
                {formatMoney(activeLease.rent_cents)}<small>/月</small>
              </span>
            )}
          </div>

          {activeLease && (
            <div className="current-lease-banner">
              <div className="current-lease-icon">
                <CalendarClock size={20} />
              </div>
              <div>
                <span>当前租约</span>
                <strong>
                  {activeLease.room.property_name} · {activeLease.room.name}
                </strong>
                <small>
                  {tenure(activeLease.start_date, activeLease.end_date)} · 每月{" "}
                  {activeLease.rent_due_day || 1} 日收租
                </small>
              </div>
              <StatusPill
                kind={activeLease.display_status}
                label={leaseStatusLabels[activeLease.display_status]}
              />
            </div>
          )}

          {hasLeaseHistory ? (
            <div className="table-panel embedded-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>房间</th>
                    <th>租期</th>
                    <th>月租</th>
                    <th>押金</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {tenant.leases.map((lease) => (
                    <tr key={lease.id}>
                      <td data-label="房间">
                        <div className="cell-stack">
                          <strong>{lease.room.name}</strong>
                          <small>{lease.room.property_name}</small>
                        </div>
                      </td>
                      <td data-label="租期">{tenure(lease.start_date, lease.end_date)}</td>
                      <td data-label="月租">{formatMoney(lease.rent_cents)}</td>
                      <td data-label="押金">{formatMoney(lease.deposit_cents)}</td>
                      <td data-label="状态">
                        <StatusPill
                          kind={lease.display_status}
                          label={leaseStatusLabels[lease.display_status]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              compact
              icon={<ScrollText size={22} />}
              title="还没有合同记录"
              description={
                isViewer
                  ? "该租客目前没有合同记录。"
                  : "为这位租客创建第一份合同，房间状态会自动变为已租。"
              }
              action={
                isViewer ? undefined : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => navigate(`/leases?new=1&tenantId=${tenant.id}`)}
                  >
                    创建合同
                  </Button>
                )
              }
            />
          )}
        </section>
      </div>

      <Modal
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        title={`${tenant.name} · 身份证照片`}
        width={760}
      >
        <div className="id-full-image">
          <img src={`/api/tenants/${tenant.id}/id-image`} alt={`${tenant.name}的身份证照片`} />
        </div>
        <p className="privacy-note">
          <ShieldCheck size={15} />
          请勿拍照、截图或转发他人证件信息。
        </p>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={removeTenant}
        title="删除这位租客？"
        description="如果租客已有合同记录，系统会拒绝删除以保留历史。请确认后继续。"
        confirmLabel="删除租客"
        danger
        loading={deleting}
      />
    </div>
  );
}
