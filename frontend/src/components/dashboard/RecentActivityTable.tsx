import DataTable, { type Column } from "../ui/DataTable";
import StatusBadge from "../ui/StatusBadge";
import type { DashboardOverview } from "../../types/api";

type Activity = DashboardOverview["recentActivity"][number];
const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const eventStatuses: Record<string, string> = {
  JOB_CREATED: "NEW",
  JOB_UPDATED: "UPDATED",
  JOB_PICKED_UP: "PICKED_UP",
  JOB_DELIVERED: "DELIVERED",
  JOB_CANCELLED: "CANCELLED",
  ASSIGNMENT_CREATED: "PENDING",
  ASSIGNMENT_ACCEPTED: "ACCEPTED",
  ASSIGNMENT_REJECTED: "REJECTED",
  ASSIGNMENT_REASSIGNED: "REASSIGNED",
  MANUAL_QUEUE_RETRY: "MANUAL_QUEUE",
  MANUAL_QUEUE_DISMISSED: "CANCELLED",
};

function formatEvent(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const columns: Column<Activity>[] = [
  {
    key: "event",
    header: "Event",
    render: (item) => <span className="font-semibold text-ink">{formatEvent(item.eventType)}</span>,
  },
  {
    key: "order",
    header: "Order reference",
    render: (item) => <span className="font-medium text-ink">{item.orderReference}</span>,
  },
  {
    key: "actor",
    header: "Actor",
    render: (item) => <span className="text-muted">{item.actor}</span>,
  },
  {
    key: "timestamp",
    header: "Timestamp",
    render: (item) => (
      <time className="whitespace-nowrap text-muted" dateTime={item.timestamp}>
        {dateFormat.format(new Date(item.timestamp))}
      </time>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (item) => <StatusBadge value={eventStatuses[item.eventType] ?? "UNKNOWN"} />,
  },
];

export default function RecentActivityTable({ activities }: { activities: Activity[] }) {
  return (
    <DataTable
      columns={columns}
      emptyDescription="Audit events will appear here as dispatch activity occurs."
      emptyTitle="No recent activity"
      rows={activities.slice(0, 10)}
    />
  );
}
