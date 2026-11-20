import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";

type ToastMessage = { id: number; message: string; kind: "success" | "error" };
type ToastContextValue = { notify: (message: string, kind?: ToastMessage["kind"]) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const notify = useCallback((message: string, kind: ToastMessage["kind"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4500);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="fixed right-4 top-4 z-[60] flex w-[min(360px,calc(100%-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div className="flex items-start gap-3 rounded-lg border border-line bg-white p-4 shadow-lg" key={toast.id} role="status">
            {toast.kind === "success" ? <CheckCircle2 className="mt-0.5 shrink-0 text-brand" size={18} /> : <XCircle className="mt-0.5 shrink-0 text-rose-600" size={18} />}
            <p className="flex-1 text-sm text-ink">{toast.message}</p>
            <button aria-label="Dismiss notification" className="text-muted hover:text-ink" onClick={() => setToasts((current) => current.filter(({ id }) => id !== toast.id))}><X size={16} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider.");
  return context;
}
