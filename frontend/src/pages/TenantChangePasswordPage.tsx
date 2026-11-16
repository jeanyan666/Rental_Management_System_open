import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import { Button, Field } from "../components/UI";

export function TenantChangePasswordPage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (newPassword.length < 4) {
      setError("新密码至少需要 4 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setSaving(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      await refreshUser();
      toast("密码修改成功", "success");
      navigate("/tenant", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "密码修改失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tenant-password-page">
      <section className="tenant-password-card">
        <div className="tenant-password-icon">
          <KeyRound size={25} />
        </div>
        <span className="eyebrow">ACCOUNT SECURITY</span>
        <h1>{user?.must_change_password ? "请先修改初始密码" : "修改登录密码"}</h1>
        <p>
          {user?.must_change_password
            ? "为了保护你的租务信息，首次登录需要设置一个新密码。"
            : "定期更换密码可以更好地保护你的租金和水电记录。"}
        </p>

        <form onSubmit={submit} className="stack-form tenant-password-form">
          <Field
            label={user?.must_change_password ? "初始密码" : "当前密码"}
            htmlFor="tenant-current-password"
            required
          >
            <input
              id="tenant-current-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="新密码" htmlFor="tenant-new-password" required hint="至少 4 位字符">
            <input
              id="tenant-new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="确认新密码" htmlFor="tenant-confirm-password" required>
            <input
              id="tenant-confirm-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </Field>
          {error && <div className="form-error-banner">{error}</div>}
          <Button type="submit" loading={saving} className="tenant-password-submit">
            保存新密码
          </Button>
        </form>

        <div className="tenant-password-note">
          <ShieldCheck size={15} />
          新密码只保存在本系统，不会以明文形式存储。
        </div>
      </section>
    </div>
  );
}
