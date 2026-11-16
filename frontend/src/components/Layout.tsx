import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  ChevronRight,
  DatabaseBackup,
  Droplets,
  Eye,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Settings2,
  UserCog,
  Users,
  ScrollText,
  Wallet,
} from "lucide-react";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import { Avatar, Button, Field, IconButton, Modal } from "./UI";
import { Logo } from "./Logo";

const navItems = [
  { to: "/", label: "概览", icon: LayoutDashboard, end: true },
  { to: "/properties", label: "房源", icon: Building2 },
  { to: "/tenants", label: "租客", icon: Users },
  { to: "/leases", label: "合同", icon: ScrollText },
  { to: "/rents", label: "收租", icon: Wallet },
  { to: "/utilities", label: "水电", icon: Droplets },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const isViewer = user?.role === "viewer";

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  const closePasswordDialog = () => {
    setPasswordOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setFormError("");
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (newPassword.length < 4) {
      setFormError("新密码至少需要 4 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("两次输入的新密码不一致");
      return;
    }
    setSaving(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      toast("密码已更新", "success");
      closePasswordDialog();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.detail : "修改失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`app-shell${isViewer ? " viewer-mode" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <Logo />
          <nav className="side-nav" aria-label="主导航">
            <span className="nav-caption">工作台</span>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <KeyRound size={16} />
            <p>身份证照片仅保存在系统内，不会上传到第三方。</p>
          </div>
          <div className="account-card">
            <Avatar name={user?.display_name || "房东"} id={user?.id} size="sm" />
            <div className="account-copy">
              <strong>{user?.display_name || "房东"}</strong>
              <span>{isViewer ? "只读管理员" : "超级管理员"}</span>
            </div>
            {isViewer && <span className="viewer-badge">只读</span>}
            <IconButton label="账户设置" onClick={() => setPasswordOpen(true)} className="account-action">
              <Settings2 size={17} />
            </IconButton>
            <IconButton label="退出登录" onClick={handleLogout} className="account-action">
              <LogOut size={17} />
            </IconButton>
          </div>
        </div>
      </aside>

      <header className="mobile-header">
        <Logo />
        <button type="button" className="mobile-account" onClick={() => setPasswordOpen(true)}>
          <Avatar name={user?.display_name || "房东"} id={user?.id} size="sm" />
        </button>
      </header>

      <main className="main-content">
        <div className="content-wrap">
          {isViewer && (
            <div className="readonly-banner">
              <Eye size={16} />
              <span>
                <strong>只读模式</strong>
                你可以查看与超级管理员相同的业务数据，但不能新增、修改、删除、收款或抄表。
              </span>
            </div>
          )}
          <Outlet />
        </div>
      </main>

      <nav className="mobile-nav" aria-label="移动端导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `mobile-nav-item${isActive ? " active" : ""}`}
            >
              <Icon size={20} strokeWidth={1.8} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <Modal
        open={passwordOpen}
        onClose={closePasswordDialog}
        title={isViewer ? "账户设置" : "账户与管理"}
        subtitle={`当前登录账号：${user?.username || ""}`}
        width={480}
      >
        {!isViewer && (
          <div className="account-menu-links">
          <button
            type="button"
            onClick={() => {
              closePasswordDialog();
              navigate("/accounts");
            }}
          >
            <span>
              <UserCog size={17} />
            </span>
            <div>
              <strong>租客账号</strong>
              <small>查看账号、重置密码、启用或停用</small>
            </div>
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              closePasswordDialog();
              navigate("/backup");
            }}
          >
            <span>
              <DatabaseBackup size={17} />
            </span>
            <div>
              <strong>数据备份</strong>
              <small>导出完整数据或从备份恢复</small>
            </div>
            <ChevronRight size={16} />
          </button>
          </div>
        )}
        {!isViewer && <div className="account-menu-divider" />}
        <form onSubmit={submitPassword} className="stack-form">
          <Field label="当前密码" htmlFor="current-password" required>
            <input
              id="current-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="新密码" htmlFor="new-password" required hint="至少 4 位字符">
            <input
              id="new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="确认新密码" htmlFor="confirm-password" required>
            <input
              id="confirm-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </Field>
          {formError && <div className="form-error-banner">{formError}</div>}
          <div className="modal-inline-actions account-modal-actions">
            <Button
              type="button"
              variant="ghost"
              icon={<LogOut size={15} />}
              onClick={handleLogout}
            >
              退出登录
            </Button>
            <span className="modal-action-spacer" />
            <Button type="button" variant="secondary" onClick={closePasswordDialog}>
              取消
            </Button>
            <Button type="submit" loading={saving}>
              保存新密码
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
