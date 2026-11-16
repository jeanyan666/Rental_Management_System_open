import { Link } from "react-router-dom";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="brand" aria-label="梁寓租务首页">
      <span className="brand-mark">
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <path d="M7 19.4 20 8l13 11.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11.5 17.8v13.5h17V17.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M16.2 31.3v-7.1c0-2.1 1.7-3.8 3.8-3.8s3.8 1.7 3.8 3.8v7.1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="30.2" cy="11.5" r="2.3" fill="currentColor" />
        </svg>
      </span>
      {!compact && (
        <span className="brand-copy">
          <strong>梁寓</strong>
          <small>租务管理</small>
        </span>
      )}
    </Link>
  );
}
