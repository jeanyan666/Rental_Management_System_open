import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Eye,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
  UserCog,
  UserRoundX,
  UsersRound,
} from "lucide-react";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { TenantAccount, ViewerAccount } from "../types";
import { formatDateTime } from "../utils";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  LoadingBlock,
  Modal,
  PageHeader,
} from "../components/UI";

interface AccountTarget {
  id: number;
  username: string;
  display_name: string;
  role: "tenant" | "viewer";
}

export function AccountsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<TenantAccount[]>([]);
  const [viewer, setViewer] = useState<ViewerAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetTarget, setResetTarget] = useState<AccountTarget | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [editTarget, setEditTarget] = useState<AccountTarget | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [disableTarget, setDisableTarget] = useState<AccountTarget | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [createViewerOpen, setCreateViewerOpen] = useState(false);
  const [viewerUsername, setViewerUsername] = useState("");
  const [viewerPassword, setViewerPassword] = useState("");
  const [viewerPasswordConfirm, setViewerPasswordConfirm] = useState("");
  const [viewerError, setViewerError] = useState("");
  const [creatingViewer, setCreatingViewer] = useState(false);

  const load = async () => {
    try {
      const result = await api<{ accounts: TenantAccount[]; viewer: ViewerAccount | null }>(
        "/api/accounts",
      );
      setAccounts(result.accounts);
      setViewer(result.viewer);
    } catch (error) {
      toast(error instanceof ApiError ? error.detail : "账号加载失败", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetPassword = async () => {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const result = await api<{ temporary_password: string }>(
        `/api/accounts/${resetTarget.id}/reset-password`,
        { method: "POST" },
      );
      setTemporaryPassword(result.temporary_password);
      toast("临时密码已生成", "success");
      await load();
    } catch (error) {
      toast(error instanceof ApiError ? error.detail : "重置失败", "error");
    } finally {
      setResetting(false);
    }
  };

  const toggleActive = async (account: AccountTarget, nextActive: boolean) => {
    if (!nextActive) {
      setDisableTarget(account);
      return;
    }
    try {
      await api(`/api/accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: true }),
      });
      toast("账号已启用", "success");
      await load();
    } catch (error) {
      toast(error instanceof ApiError ? error.detail : "操作失败", "error");
    }
  };

  const confirmDisable = async () => {
    if (!disableTarget) return;
    setDisabling(true);
    try {
      await api(`/api/accounts/${disableTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: false }),
      });
      toast("账号已停用", "success");
      setDisableTarget(null);
      await load();
    } catch (error) {
      toast(error instanceof ApiError ? error.detail : "停用失败", "error");
    } finally {
      setDisabling(false);
    }
  };

  const openEdit = (account: AccountTarget) => {
    setEditTarget(account);
    setEditUsername(account.username);
    setEditError("");
  };

  const saveUsername = async () => {
    if (!editTarget) return;
    const value = editUsername.trim();
    if (value.length < 4) {
      setEditError("登录账号至少需要 4 位");
      return;
    }
    setSavingEdit(true);
    try {
      await api(`/api/accounts/${editTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({ username: value }),
      });
      toast("登录账号已更新", "success");
      setEditTarget(null);
      await load();
    } catch (error) {
      setEditError(error instanceof ApiError ? error.detail : "保存失败");
    } finally {
      setSavingEdit(false);
    }
  };

  const createViewer = async () => {
    if (viewerUsername.trim().length < 4) {
      setViewerError("登录账号至少需要 4 位");
      return;
    }
    if (viewerPassword.length < 4) {
      setViewerError("密码至少需要 4 位");
      return;
    }
    if (viewerPassword !== viewerPasswordConfirm) {
      setViewerError("两次输入的密码不一致");
      return;
    }
    setCreatingViewer(true);
    try {
      await api("/api/accounts/viewer", {
        method: "POST",
        body: JSON.stringify({
          username: viewerUsername.trim(),
          password: viewerPassword,
          display_name: "只读管理员",
        }),
      });
      toast("只读管理员账号已创建", "success");
      setCreateViewerOpen(false);
      setViewerUsername("");
      setViewerPassword("");
      setViewerPasswordConfirm("");
      setViewerError("");
      await load();
    } catch (error) {
      setViewerError(error instanceof ApiError ? error.detail : "创建失败");
    } finally {
      setCreatingViewer(false);
    }
  };

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      toast("临时密码已复制", "success");
    } catch {
      toast("复制失败，请手动选中", "error");
    }
  };

  if (loading) return <LoadingBlock text="正在读取账号" />;

  const activeCount = accounts.filter((account) => account.is_active).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="ACCOUNTS"
        title="账号管理"
        description="租客使用当前房号登录；系统同时管理唯一一个只读管理员账号。"
        back={
          <button type="button" className="back-link" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> 返回
          </button>
        }
        actions={
          <Button
            variant="secondary"
            icon={<ShieldCheck size={16} />}
            onClick={() => navigate("/backup")}
          >
            数据备份
          </Button>
        }
      />

      <section className="panel viewer-management-card">
        <div className="viewer-management-head">
          <div className="viewer-management-title">
            <span className="viewer-management-icon">
              <Eye size={21} />
            </span>
            <div>
              <span className="eyebrow">READ ONLY</span>
              <h2>只读管理员</h2>
              <p>可以查看与超级管理员相同的全部业务数据，但不能新增、修改、删除、收款或导出。</p>
            </div>
          </div>
          {!viewer && (
            <Button icon={<Plus size={16} />} onClick={() => setCreateViewerOpen(true)}>
              创建只读账号
            </Button>
          )}
        </div>

        {viewer ? (
          <div className="viewer-account-row">
            <div className="account-person">
              <strong>{viewer.display_name}</strong>
              <small>登录账号：{viewer.username}</small>
              <small>最近登录：{formatDateTime(viewer.last_login_at, "从未登录")}</small>
            </div>
            <span
              className={
                viewer.is_active
                  ? "account-status account-status-on"
                  : "account-status account-status-off"
              }
            >
              {viewer.is_active ? "启用中" : "已停用"}
            </span>
            <div className="viewer-account-actions">
              <button type="button" className="text-button" onClick={() => openEdit(viewer)}>
                <Pencil size={13} /> 修改账号
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setResetTarget(viewer);
                  setTemporaryPassword("");
                }}
              >
                <KeyRound size={13} /> 重置密码
              </button>
              {viewer.is_active ? (
                <button
                  type="button"
                  className="text-button danger-text"
                  onClick={() => toggleActive(viewer, false)}
                >
                  <UserRoundX size={13} /> 停用
                </button>
              ) : (
                <button
                  type="button"
                  className="text-button accent"
                  onClick={() => toggleActive(viewer, true)}
                >
                  <CheckCircle2 size={13} /> 启用
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="viewer-empty-note">
            尚未创建只读账号。系统只允许创建一个，创建后不能新增第二个。
          </div>
        )}
      </section>

      <div className="account-summary-strip">
        <div>
          <span className="stat-icon sand">
            <UsersRound size={18} />
          </span>
          <p>
            共 <strong>{accounts.length}</strong> 个租客账号，<strong>{activeCount}</strong> 个启用中
          </p>
        </div>
        <span>登录名固定为当前房号；默认密码为房号 + 身份证后 4 位</span>
      </div>

      {!accounts.length ? (
        <div className="panel">
          <EmptyState
            icon={<UserCog size={30} />}
            title="还没有租客账号"
            description="为租客创建合同后，系统会自动生成登录账号。"
            action={
              <Button variant="secondary" onClick={() => navigate("/leases")}>
                查看合同
              </Button>
            }
          />
        </div>
      ) : (
        <div className="table-panel">
          <table className="data-table account-table">
            <thead>
              <tr>
                <th>租客</th>
                <th>登录账号</th>
                <th>当前房间</th>
                <th>账号状态</th>
                <th>最近登录</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td data-label="租客">
                    <div className="account-person">
                      <strong>{account.display_name}</strong>
                      <small>{account.tenant?.phone || "未留手机号"}</small>
                      <small>{account.tenant?.id_number_masked || "未登记身份证"}</small>
                    </div>
                  </td>
                  <td data-label="登录账号">
                    <span className="account-username">{account.username}</span>
                  </td>
                  <td data-label="当前房间">
                    {account.active_lease ? (
                      <div className="cell-stack">
                        <strong>{account.active_lease.room_name}</strong>
                        <small>{account.active_lease.property_name}</small>
                      </div>
                    ) : (
                      <span className="cell-muted">无在租合同</span>
                    )}
                  </td>
                  <td data-label="账号状态">
                    <div className="account-status-stack">
                      <span
                        className={
                          account.is_active
                            ? "account-status account-status-on"
                            : "account-status account-status-off"
                        }
                      >
                        {account.is_active ? "启用中" : "已停用"}
                      </span>
                    </div>
                  </td>
                  <td data-label="最近登录">
                    <span className={account.last_login_at ? "cell-text" : "cell-muted"}>
                      {formatDateTime(account.last_login_at, "从未登录")}
                    </span>
                  </td>
                  <td className="table-action-cell account-actions-cell">
                    <div className="account-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setResetTarget(account);
                          setTemporaryPassword("");
                        }}
                      >
                        <KeyRound size={13} /> 重置密码
                      </button>
                      {account.is_active ? (
                        <button
                          type="button"
                          className="text-button danger-text"
                          onClick={() => toggleActive(account, false)}
                        >
                          <UserRoundX size={13} /> 停用
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-button accent"
                          onClick={() => toggleActive(account, true)}
                        >
                          <CheckCircle2 size={13} /> 启用
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={createViewerOpen}
        onClose={() => {
          setCreateViewerOpen(false);
          setViewerError("");
        }}
        title="创建只读管理员"
        subtitle="系统只允许一个只读管理员账号"
        width={480}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCreateViewerOpen(false)}
            >
              取消
            </Button>
            <Button type="button" onClick={createViewer} loading={creatingViewer}>
              创建账号
            </Button>
          </>
        }
      >
        <div className="stack-form">
          <Field label="登录账号" htmlFor="viewer-username" required hint="4–64 位字母、数字或常用符号">
            <input
              id="viewer-username"
              className="input"
              value={viewerUsername}
              onChange={(event) => setViewerUsername(event.target.value)}
              autoFocus
            />
          </Field>
          <Field label="初始密码" htmlFor="viewer-password" required hint="至少 4 位">
            <input
              id="viewer-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={viewerPassword}
              onChange={(event) => setViewerPassword(event.target.value)}
            />
          </Field>
          <Field label="确认密码" htmlFor="viewer-password-confirm" required>
            <input
              id="viewer-password-confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              value={viewerPasswordConfirm}
              onChange={(event) => setViewerPasswordConfirm(event.target.value)}
            />
          </Field>
          {viewerError && <div className="form-error-banner">{viewerError}</div>}
        </div>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={() => {
          setResetTarget(null);
          setTemporaryPassword("");
        }}
        title="重置账号密码"
        subtitle={resetTarget ? `${resetTarget.display_name} · ${resetTarget.username}` : undefined}
        width={460}
        footer={
          temporaryPassword ? (
            <Button
              type="button"
              onClick={() => {
                setResetTarget(null);
                setTemporaryPassword("");
              }}
            >
              完成
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setResetTarget(null)}
              >
                取消
              </Button>
              <Button type="button" onClick={resetPassword} loading={resetting}>
                确认重置
              </Button>
            </>
          )
        }
      >
        {temporaryPassword ? (
          <div className="temporary-password">
            <span>临时密码</span>
            <div>
              <code>{temporaryPassword}</code>
              <IconButton label="复制临时密码" onClick={copyPassword}>
                <Copy size={15} />
              </IconButton>
            </div>
            <p>
              {resetTarget?.role === "viewer"
                ? "请把临时密码告知只读管理员。登录后可以在账户设置中自行修改。"
                : "请把临时密码告知租客。当前版本租客不能自行修改密码，如需更换只能由你在这里重置。"}
            </p>
          </div>
        ) : (
          <div className="form-callout warning">
            <KeyRound size={17} />
            <span>
              {resetTarget?.role === "viewer"
                ? "重置后，原密码立即失效，系统会生成一个随机临时密码，账号会重新启用。"
                : "重置后，原密码立即失效，账号会重新启用。新密码按“房号 + 身份证后 4 位”生成；没有身份证时使用手机号后 4 位。"}
            </span>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title="修改登录账号"
        subtitle={editTarget?.display_name}
        width={460}
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => setEditTarget(null)}>
              取消
            </Button>
            <Button type="button" onClick={saveUsername} loading={savingEdit}>
              保存账号
            </Button>
          </>
        }
      >
        <Field
          label="登录账号"
          htmlFor="account-username"
          hint="可使用手机号或 4–64 位字母、数字组合"
          error={editError}
        >
          <input
            id="account-username"
            className="input"
            value={editUsername}
            onChange={(event) => setEditUsername(event.target.value)}
            autoFocus
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(disableTarget)}
        onClose={() => setDisableTarget(null)}
        onConfirm={confirmDisable}
        title="停用这个账号？"
        description={`停用后，${disableTarget?.display_name || "该账号"}将无法登录。`}
        confirmLabel="停用账号"
        danger
        loading={disabling}
      />
    </div>
  );
}
