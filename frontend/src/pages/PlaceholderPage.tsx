import { Construction } from "lucide-react";

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="panel flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 rounded-xl bg-emerald-50 p-3 text-brand"><Construction size={22} /></span>
      <h2 className="text-base font-semibold text-ink">{title} workspace</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted">This module is part of the RELAY Dispatch Desk foundation. Its workflows will be added in a follow-up implementation.</p>
    </section>
  );
}
