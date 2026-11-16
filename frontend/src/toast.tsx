import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = ++counter.current;
      setItems((current) => [...current.slice(-3), { id, message, kind }]);
      window.setTimeout(() => remove(id), 4200);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div className={`toast toast-${item.kind}`} key={item.id}>
            {item.kind === "success" ? (
              <CheckCircle2 size={18} />
            ) : item.kind === "error" ? (
              <AlertCircle size={18} />
            ) : (
              <Info size={18} />
            )}
            <span>{item.message}</span>
            <button type="button" className="toast-close" onClick={() => remove(item.id)} aria-label="关闭提示">
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
