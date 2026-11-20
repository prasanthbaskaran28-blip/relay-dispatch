import { CalendarDays } from "lucide-react";

export default function DashboardDateFilter({
  from,
  to,
  draftFrom,
  draftTo,
  onFromChange,
  onToChange,
  onApply,
  invalid,
}: {
  from: string;
  to: string;
  draftFrom: string;
  draftTo: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onApply: () => void;
  invalid: boolean;
}) {
  const changed = draftFrom !== from || draftTo !== to;

  return (
    <section className="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarDays aria-hidden="true" className="text-brand" size={17} />
          Trend date range
        </div>
        <p className="text-xs text-muted">Choose up to 366 days. KPI totals and alerts remain current.</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="text-xs font-medium text-muted">
          From
          <input
            aria-label="Trend start date"
            className="input mt-1 block w-full sm:w-40"
            max={draftTo || undefined}
            onChange={(event) => onFromChange(event.target.value)}
            type="date"
            value={draftFrom}
          />
        </label>
        <label className="text-xs font-medium text-muted">
          To
          <input
            aria-label="Trend end date"
            className="input mt-1 block w-full sm:w-40"
            min={draftFrom || undefined}
            onChange={(event) => onToChange(event.target.value)}
            type="date"
            value={draftTo}
          />
        </label>
        <button className="button-primary" disabled={!changed || invalid} onClick={onApply}>
          Apply range
        </button>
      </div>
      {invalid && (
        <p className="text-xs font-medium text-rose-700 sm:basis-full sm:text-right">
          Select an ordered date range of no more than 366 days.
        </p>
      )}
    </section>
  );
}
