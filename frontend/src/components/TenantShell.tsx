import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "../auth";
import { Logo } from "./Logo";
import { IconButton } from "./UI";

export function TenantShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="tenant-shell">
      <header className="tenant-topbar">
        <div className="tenant-topbar-inner">
          <div className="tenant-brand">
            <Logo />
            <span>租客中心</span>
          </div>
          <div className="tenant-account">
            <span className="tenant-account-name">{user?.display_name}</span>
            <IconButton label="退出登录" onClick={handleLogout}>
              <LogOut size={17} />
            </IconButton>
          </div>
        </div>
      </header>
      <main className="tenant-main">
        <Outlet />
      </main>
      <footer className="tenant-footer">
        <span>梁寓租务 · 租客中心</span>
        <span>如账单有疑问，请联系房东核对</span>
      </footer>
    </div>
  );
}
