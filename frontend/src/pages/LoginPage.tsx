import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "../auth";
import { ApiError } from "../api";
import { Logo } from "../components/Logo";
import { Button } from "../components/UI";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const loggedIn = await login(username.trim(), password);
      navigate(loggedIn.role === "tenant" ? "/tenant" : "/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-story">
        <div className="login-story-top">
          <Logo />
        </div>

        <div className="login-story-copy">
          <span className="eyebrow light">RENTAL STUDIO</span>
          <h1>
            把房子、租客与租约，
            <br />
            安放在一处。
          </h1>
          <p>少一点翻找和遗忘，多一点从容。房源状态、身份证识别、合同到期，都在同一个安静的工作台里。</p>
        </div>

        <div className="login-illustration" aria-hidden="true">
          <svg viewBox="0 0 560 330" fill="none">
            <path d="M24 306h512" stroke="currentColor" strokeOpacity=".2" />
            <path d="M86 306V117l118-72 118 72v189" stroke="currentColor" strokeOpacity=".4" strokeWidth="1.5" />
            <path d="M322 306V175l83-49 83 49v131" stroke="currentColor" strokeOpacity=".28" strokeWidth="1.5" />
            <path d="M118 306V146l86-52 86 52v160" stroke="currentColor" strokeOpacity=".65" strokeWidth="2" />
            <path d="M151 306v-95h56v95M217 208h56v98" stroke="currentColor" strokeOpacity=".65" strokeWidth="2" />
            <path d="M171 180h28M250 180h28M351 233h36v73M401 220h36v86" stroke="currentColor" strokeOpacity=".4" strokeWidth="2" />
            <circle cx="438" cy="88" r="31" stroke="currentColor" strokeOpacity=".25" />
            <path d="m429 88 7 7 13-15" stroke="currentColor" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
            <path d="M70 306h100M126 260c0-24 12-43 31-55" stroke="currentColor" strokeOpacity=".25" />
            <path d="M126 260c-18-3-29-14-32-30 18 1 29 11 32 30Zm0 0c18-3 29-14 32-30-18 1-29 11-32 30Z" fill="currentColor" fillOpacity=".16" />
          </svg>
        </div>

        <div className="login-story-foot">
          <span>
            <ShieldCheck size={16} /> 本地 OCR · 照片不出本机
          </span>
          <span>梁寓 0.1</span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-mobile-brand">
          <Logo />
        </div>
        <div className="login-card">
          <div className="login-heading">
            <span className="eyebrow">WELCOME BACK</span>
            <h2>欢迎回来</h2>
            <p>管理员与租客使用同一入口登录。</p>
          </div>

          <form onSubmit={submit} className="login-form">
            <label className="login-field" htmlFor="login-username">
              <span>账号</span>
              <div className="login-input-wrap">
                <UserRound size={18} />
                <input
                  id="login-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  placeholder="请输入房号"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoFocus
                  required
                />
              </div>
            </label>

            <label className="login-field" htmlFor="login-password">
              <span>密码</span>
              <div className="login-input-wrap">
                <LockKeyhole size={18} />
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="请输入房号加身份证后4位"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {error && <div className="form-error-banner">{error}</div>}

            <Button type="submit" loading={submitting} className="login-submit">
              登录
              <ArrowRight size={17} />
            </Button>
          </form>

          <p className="login-note">
            <ShieldCheck size={15} />
            数据保存在本机 SQLite 数据库中
          </p>
        </div>
      </section>
    </div>
  );
}
