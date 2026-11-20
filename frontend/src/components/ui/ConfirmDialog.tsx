import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={onCancel}>
      <section aria-labelledby="dialog-title" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="mb-4 flex items-start justify-between">
          <span className="rounded-lg bg-amber-50 p-2 text-amber-700"><AlertTriangle size={20} /></span>
          <button aria-label="Close dialog" className="icon-button" onClick={onCancel}><X size={17} /></button>
        </div>
        <h2 className="text-lg font-semibold text-ink" id="dialog-title">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button className="button-secondary" onClick={onCancel}>Cancel</button>
          <button className="button-primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
