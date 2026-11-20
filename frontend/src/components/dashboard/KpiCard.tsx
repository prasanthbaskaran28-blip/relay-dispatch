import type { LucideIcon } from "lucide-react";

export default function KpiCard({
  title,
  value,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <section className="panel flex min-h-32 items-start justify-between gap-3 p-5">
      <div>
        <p className="text-sm font-medium text-muted">{title}</p>
        <p className="mt-3 text-[30px] font-bold leading-none tracking-tight text-ink">
          {new Intl.NumberFormat().format(value)}
        </p>
      </div>
      <span className={`rounded-lg p-2.5 ${tone}`}><Icon aria-hidden="true" size={19} /></span>
    </section>
  );
}
