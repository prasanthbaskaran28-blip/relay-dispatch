import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import EmptyState from "../ui/EmptyState";
import ErrorState from "../ui/ErrorState";
import LoadingSkeleton from "../ui/LoadingSkeleton";
import type { ZonePerformance } from "../../types/api";

const numberFormat = new Intl.NumberFormat();

export default function ZonePerformanceChart({
  zones,
  loading,
  error,
  onRetry,
}: {
  zones: ZonePerformance[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading && !zones) return <LoadingSkeleton className="h-[300px] w-full" />;
  if (error && !zones) return <ErrorState message={error} onRetry={onRetry} />;
  if (!zones || zones.length === 0) {
    return <EmptyState description="Delivery zone metrics will appear here when zones are configured." title="No zone data" />;
  }

  const chartHeight = Math.max(260, zones.length * 42);
  return (
    <div className="w-full">
      {error && <p className="mb-2 text-xs text-amber-700">{error} Showing the last loaded data.</p>}
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={zones} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#edf0f3" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              axisLine={false}
              domain={[0, 100]}
              tick={{ fill: "#718096", fontSize: 11 }}
              tickFormatter={(value) => `${value}%`}
              tickLine={false}
              type="number"
            />
            <YAxis axisLine={false} dataKey="zoneName" tick={{ fill: "#586779", fontSize: 11 }} tickLine={false} type="category" width={100} />
            <Tooltip
              formatter={(value, _name, item) => [
                `${numberFormat.format(Number(value))}% (${numberFormat.format(item.payload.jobVolume)} jobs)`,
                "Completion rate",
              ]}
              labelFormatter={(label) => String(label)}
            />
            <Bar
              dataKey="deliveryCompletionRate"
              fill="#246b5c"
              name="Completion rate"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex gap-5 text-xs text-muted">
        <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-brand" />Delivery completion rate</span>
      </div>
    </div>
  );
}
