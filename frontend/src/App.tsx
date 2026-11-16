import { useEffect } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { ToastProvider } from "./toast";
import { Layout } from "./components/Layout";
import { Logo } from "./components/Logo";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PropertiesPage } from "./pages/PropertiesPage";
import { TenantsPage } from "./pages/TenantsPage";
import { TenantFormPage } from "./pages/TenantFormPage";
import { TenantDetailPage } from "./pages/TenantDetailPage";
import { LeasesPage } from "./pages/LeasesPage";
import { UtilitiesPage } from "./pages/UtilitiesPage";
import { RentsPage } from "./pages/RentsPage";
import { AccountsPage } from "./pages/AccountsPage";
import { BackupPage } from "./pages/BackupPage";
import { TenantPortalPage } from "./pages/TenantPortalPage";
import { TenantShell } from "./components/TenantShell";

function AppKeepalive() {
  useEffect(() => {
    const ping = () => {
      fetch("/api/health", { cache: "no-store", credentials: "same-origin" }).catch(() => undefined);
    };
    const timer = window.setInterval(ping, 45_000);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}

function Splash() {
  return (
    <div className="splash-screen">
      <Logo />
      <span className="splash-line" />
      <p>正在打开工作台</p>
    </div>
  );
}

function ProtectedLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (user.role === "tenant") return <Navigate to="/tenant" replace />;
  return <Layout />;
}

function TenantGuard() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (user.role !== "tenant") return <Navigate to="/" replace />;
  return <TenantShell />;
}

function SuperAdminOnly() {
  const { user } = useAuth();
  if (user?.role !== "super_admin") return <Navigate to="/" replace />;
  return <Outlet />;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (user) {
    return <Navigate to={user.role === "tenant" ? "/tenant" : "/"} replace />;
  }
  return <LoginPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppKeepalive />
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route element={<ProtectedLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="properties" element={<PropertiesPage />} />
              <Route path="tenants" element={<TenantsPage />} />
              <Route path="tenants/:id" element={<TenantDetailPage />} />
              <Route path="leases" element={<LeasesPage />} />
              <Route path="rents" element={<RentsPage />} />
              <Route path="utilities" element={<UtilitiesPage />} />
              <Route element={<SuperAdminOnly />}>
                <Route path="tenants/new" element={<TenantFormPage />} />
                <Route path="tenants/:id/edit" element={<TenantFormPage />} />
                <Route path="accounts" element={<AccountsPage />} />
                <Route path="backup" element={<BackupPage />} />
              </Route>
            </Route>
            <Route path="/tenant" element={<TenantGuard />}>
              <Route index element={<TenantPortalPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
