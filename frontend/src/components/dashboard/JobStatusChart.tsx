import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import EmptyState from "../ui/EmptyState";
import type { DashboardOverview } from "../../types/api";

const numberFormat = new Intl.NumberFormat();

export default function JobStatusChart({ jobs }: { jobs: DashboardOverview["jobs"] }) {
  const knownStatusTotal =
    jobs.awaitingConfirmation +
    jobs.accepted +
    jobs.pickedUp +
    jobs.delivered +
    jobs.manualQueue +
    jobs.cancelled;
  const unclassifiedTotal = Math.max(0, jobs.total - knownStatusTotal);
  const data = [
    { name: "New / ready", value: unclassifiedTotal, color: "#94a3b8" },
    { name: "Awaiting confirmation", value: jobs.awaitingConfirmation, color: "#3b82f6" },
    { name: "Accepted", value: jobs.accepted, color: "#f59e0b" },
    { name: "Picked up", value: jobs.pickedUp, color: "#10b981" },
    { name: "Delivered", value: jobs.delivered, color: "#6366f1" },
    { name: "Manual queue", value: jobs.manualQueue, color: "#f97316" },
    { name: "Cancelled", value: jobs.cancelled, color: "#64748b" },
  ].filter((item) => item.value > 0);

  if (jobs.total === 0 || data.length === 0) {
    return <EmptyState description="Job statuses will appear here when jobs enter the system." title="No job data yet" />;
  }

  return (
    <div className="grid min-h-[260px] items-center gap-2 sm:grid-cols-[minmax(180px,1fr)_minmax(150px,1fr)]">
      <div className="h-[260px] min-w-0">
        <ResponsiveContainer height="100%" width="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius="58%"
              nameKey="name"
              outerRadius="82%"
              paddingAngle={2}
              stroke="none"
            >
              {data.map((item) => <Cell fill={item.color} key={item.name} />)}
            </Pie>
            <Tooltip formatter={(value) => [numberFormat.format(Number(value)), "Jobs"]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-3 pb-3 text-xs sm:grid-cols-1">
        {data.map((item) => (
          <li className="flex items-center justify-between gap-2" key={item.name}>
            <span className="flex min-w-0 items-center gap-2 text-muted">
              <i aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="truncate">{item.name}</span>
            </span>
            <span className="font-semibold tabular-nums text-ink">{numberFormat.format(item.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
