import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import EmptyState from "../ui/EmptyState";
import ErrorState from "../ui/ErrorState";
import LoadingSkeleton from "../ui/LoadingSkeleton";
import type { DashboardTrends } from "../../types/api";

const numberFormat = new Intl.NumberFormat();

function formatDay(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function JobTrendsChart({
  trends,
  loading,
  error,
  onRetry,
}: {
  trends: DashboardTrends | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) return <LoadingSkeleton className="h-[280px] w-full" />;
  if (error && !trends) return <ErrorState message={error} onRetry={onRetry} />;
  if (!trends || trends.days.length === 0) {
    return <EmptyState description="No daily trend data is available for this range." title="No trend data" />;
  }

  return (
    <div className="h-[280px] w-full">
      {error && <p className="mb-2 text-xs text-amber-700">{error} Showing the last loaded range.</p>}
      <ResponsiveContainer height="100%" width="100%">
        <LineChart data={trends.days} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#edf0f3" strokeDasharray="3 3" vertical={false} />
          <XAxis axisLine={false} dataKey="date" tick={{ fill: "#718096", fontSize: 11 }} tickFormatter={formatDay} tickLine={false} />
          <YAxis allowDecimals={false} axisLine={false} tick={{ fill: "#718096", fontSize: 11 }} tickFormatter={(value) => numberFormat.format(Number(value))} tickLine={false} />
          <Tooltip
            formatter={(value, name) => [numberFormat.format(Number(value)), name === "createdJobs" ? "Created" : "Delivered"]}
            labelFormatter={(label) => formatDay(String(label))}
          />
          <Line activeDot={{ r: 5 }} dataKey="createdJobs" dot={false} name="createdJobs" stroke="#246b5c" strokeWidth={2.5} type="monotone" />
          <Line activeDot={{ r: 5 }} dataKey="deliveredJobs" dot={false} name="deliveredJobs" stroke="#ed9b40" strokeWidth={2.5} type="monotone" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
