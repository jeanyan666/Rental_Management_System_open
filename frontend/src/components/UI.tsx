import {
  createContext,
  useContext,
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, X } from "lucide-react";
import type { LeaseDisplayStatus, RoomStatus } from "../types";
import { cn, initials, leaseStatusLabels, roomStatusLabels } from "../utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn("btn", `btn-${variant}`, size === "sm" && "btn-sm", className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle className="spin" size={16} /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={cn("icon-btn", className)} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("field", error && "field-error", className)}>
      <label htmlFor={htmlFor}>
        {label}
        {required && <span className="required">*</span>}
      </label>
      {children}
      {error ? <span className="field-message error-text">{error}</span> : hint ? <span className="field-message">{hint}</span> : null}
    </div>
  );
}

export function StatusPill({
  kind,
  label,
}: {
  kind: RoomStatus | LeaseDisplayStatus;
  label?: string;
}) {
  const roomLabel = kind in roomStatusLabels ? roomStatusLabels[kind as RoomStatus] : undefined;
  const leaseLabel = kind in leaseStatusLabels ? leaseStatusLabels[kind as LeaseDisplayStatus] : undefined;
  return <span className={cn("status-pill", `status-${kind}`)}>{label || roomLabel || leaseLabel}</span>;
}

const avatarTones = ["clay", "sage", "sand", "ocean", "plum"];

export function Avatar({ name, id = 0, size = "md" }: { name: string; id?: number; size?: "sm" | "md" | "lg" }) {
  const tone = avatarTones[Math.abs(id) % avatarTones.length];
  return (
    <span className={cn("avatar", `avatar-${tone}`, `avatar-${size}`)} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        {back}
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn("empty-state", compact && "empty-state-compact")}>
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

const ModalCloseContext = createContext<(() => void) | null>(null);
export function useModalClose() {
  return useContext(ModalCloseContext);
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <ModalCloseContext.Provider value={onClose}>
      <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <section className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <header className="modal-header">
            <div>
              <h2 id={titleId}>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <IconButton label="关闭" onClick={onClose}>
              <X size={19} />
            </IconButton>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-footer">{footer}</footer>}
        </section>
      </div>
    </ModalCloseContext.Provider>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "确认",
  danger = false,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={440}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="confirm-copy">{description}</p>
    </Modal>
  );
}

export function LoadingBlock({ text = "正在加载" }: { text?: string }) {
  return (
    <div className="loading-block">
      <LoaderCircle className="spin" size={20} />
      <span>{text}</span>
    </div>
  );
}
