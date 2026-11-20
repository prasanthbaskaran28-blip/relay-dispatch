import { AlertTriangle, Clock3, ListTodo, UserRoundCheck } from "lucide-react";
import type { DashboardOverview } from "../../types/api";

const numberFormat = new Intl.NumberFormat();

export default function OperationalAlerts({ overview }: { overview: DashboardOverview }) {
  const alerts = [
    {
      title: "Approaching deadline",
      description: `Due within ${overview.operationalPerformance.deadlineWarningWindowMinutes} minutes`,
      value: overview.operationalPerformance.jobsApproachingDeadline,
      icon: Clock3,
      tone: "border-amber-200 bg-amber-50 text-amber-800",
    },
    {
      title: "Overdue active jobs",
      description: "Require immediate attention",
      value: overview.operationalPerformance.overdueActiveJobs,
      icon: AlertTriangle,
      tone: "border-rose-200 bg-rose-50 text-rose-800",
    },
    {
      title: "Manual queue",
      description: "Waiting for dispatch action",
      value: overview.jobs.manualQueue,
      icon: ListTodo,
      tone: "border-orange-200 bg-orange-50 text-orange-800",
    },
    {
      title: "Rider confirmations",
      description: "Assignments awaiting a response",
      value: overview.assignments.pending,
      icon: UserRoundCheck,
      tone: "border-blue-200 bg-blue-50 text-blue-800",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {alerts.map(({ title, description, value, icon: Icon, tone }) => (
        <section className={`rounded-xl border p-4 ${tone}`} key={title}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">{title}</p>
            <Icon aria-hidden="true" className="shrink-0 opacity-80" size={17} />
          </div>
          <p className="mt-3 text-2xl font-bold tabular-nums">{numberFormat.format(value)}</p>
          <p className="mt-1 text-xs opacity-80">{description}</p>
        </section>
      ))}
    </div>
  );
}
