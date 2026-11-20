import type { ReactNode } from "react";

const styles: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-700",
  READY_FOR_ASSIGNMENT: "bg-blue-50 text-blue-700",
  AWAITING_CONFIRMATION: "bg-amber-50 text-amber-700",
  PENDING: "bg-amber-50 text-amber-700",
  ACCEPTED: "bg-emerald-50 text-emerald-700",
  PICKED_UP: "bg-indigo-50 text-indigo-700",
  DELIVERED: "bg-green-50 text-green-700",
  AVAILABLE: "bg-green-50 text-green-700",
  MANUAL_QUEUE: "bg-orange-50 text-orange-700",
  HIGH: "bg-orange-50 text-orange-700",
  URGENT: "bg-rose-50 text-rose-700",
  CANCELLED: "bg-slate-100 text-slate-600",
  REJECTED: "bg-rose-50 text-rose-700",
  EXPIRED: "bg-slate-100 text-slate-600",
  UNAVAILABLE: "bg-slate-100 text-slate-600",
  LOW: "bg-slate-100 text-slate-600",
  NORMAL: "bg-blue-50 text-blue-700",
};

function formatLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function StatusBadge({ value, children }: { value?: string; children?: ReactNode }) {
  const label = children ?? (value ? formatLabel(value) : "Unknown");
  const className = value ? styles[value] ?? "bg-slate-100 text-slate-700" : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}
