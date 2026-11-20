import { useState } from "react";
import {
  Clock3,
  Package,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Truck,
  UserCheck,
  UserRoundCheck,
  UserX,
} from "lucide-react";
import DashboardDateFilter from "../components/dashboard/DashboardDateFilter";
import JobStatusChart from "../components/dashboard/JobStatusChart";
import JobTrendsChart from "../components/dashboard/JobTrendsChart";
import KpiCard from "../components/dashboard/KpiCard";
import OperationalAlerts from "../components/dashboard/OperationalAlerts";
import RecentActivityTable from "../components/dashboard/RecentActivityTable";
import ZonePerformanceChart from "../components/dashboard/ZonePerformanceChart";
import ErrorState from "../components/ui/ErrorState";
import LoadingSkeleton from "../components/ui/LoadingSkeleton";
import { useDashboardData } from "../hooks/useDashboardData";

const dayMilliseconds = 24 * 60 * 60 * 1000;

function toUtcDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * dayMilliseconds);
  return { from: toUtcDateInput(from), to: toUtcDateInput(to) };
}

function isInvalidDateRange(from: string, to: string) {
  if (!from || !to) return true;
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  return (
    !Number.isFinite(fromTime) ||
    !Number.isFinite(toTime) ||
    fromTime > toTime ||
    toTime - fromTime >= 366 * dayMilliseconds
  );
}

function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => <LoadingSkeleton className="h-32" key={index} />)}
      </div>
      <LoadingSkeleton className="h-32" />
      <div className="grid gap-5 xl:grid-cols-2">
        <LoadingSkeleton className="h-[380px]" />
        <LoadingSkeleton className="h-[380px]" />
      </div>
      <LoadingSkeleton className="h-72" />
    </div>
  );
}

export default function DashboardPage() {
  const [activeRange, setActiveRange] = useState(getDefaultRange);
  const [draftFrom, setDraftFrom] = useState(activeRange.from);
  const [draftTo, setDraftTo] = useState(activeRange.to);
  const {
    overview,
    trends,
    zones,
    overviewError,
    trendsError,
    zonesError,
    overviewLoading,
    trendsLoading,
    zonesLoading,
    refresh,
    refreshTrends,
  } = useDashboardData(activeRange.from, activeRange.to);
  const initialLoading =
    overviewLoading && trendsLoading && zonesLoading && !overview && !trends && !zones;
  const refreshing = overviewLoading || trendsLoading || zonesLoading;

  if (initialLoading) return <DashboardLoading />;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          className="button-secondary"
          disabled={refreshing}
          onClick={refresh}
          type="button"
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} size={16} />
          Refresh dashboard
        </button>
      </div>

      <section aria-label="Key performance indicators">
        {overviewError && !overview ? (
          <div className="panel">
            <ErrorState message={overviewError} onRetry={refresh} />
          </div>
        ) : overview ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon={Package} title="Total jobs" tone="bg-blue-50 text-blue-700" value={overview.jobs.total} />
            <KpiCard icon={Clock3} title="Awaiting confirmation" tone="bg-amber-50 text-amber-700" value={overview.jobs.awaitingConfirmation} />
            <KpiCard icon={UserRoundCheck} title="Accepted" tone="bg-emerald-50 text-emerald-700" value={overview.jobs.accepted} />
            <KpiCard icon={Truck} title="Picked up" tone="bg-indigo-50 text-indigo-700" value={overview.jobs.pickedUp} />
            <KpiCard icon={PackageCheck} title="Delivered" tone="bg-green-50 text-green-700" value={overview.jobs.delivered} />
            <KpiCard icon={RotateCcw} title="Manual queue" tone="bg-orange-50 text-orange-700" value={overview.jobs.manualQueue} />
            <KpiCard icon={UserCheck} title="Available riders" tone="bg-teal-50 text-teal-700" value={overview.riders.available} />
            <KpiCard icon={UserX} title="Unavailable riders" tone="bg-slate-100 text-slate-700" value={overview.riders.unavailable} />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => <LoadingSkeleton className="h-32" key={index} />)}
          </div>
        )}
      </section>

      {overview && (
        <section>
          <div className="mb-3">
            <h2 className="section-title">Operational alerts</h2>
            <p className="section-caption">Live items that may need dispatch attention</p>
          </div>
          <OperationalAlerts overview={overview} />
        </section>
      )}

      {overviewError && overview && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {overviewError} Showing the last loaded overview.
        </p>
      )}

      <DashboardDateFilter
        draftFrom={draftFrom}
        draftTo={draftTo}
        from={activeRange.from}
        invalid={isInvalidDateRange(draftFrom, draftTo)}
        onApply={() => setActiveRange({ from: draftFrom, to: draftTo })}
        onFromChange={setDraftFrom}
        onToChange={setDraftTo}
        to={activeRange.to}
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="panel p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="section-title">Job status distribution</h2>
            <p className="section-caption">Current jobs grouped by operational status</p>
          </div>
          {overview ? (
            <JobStatusChart jobs={overview.jobs} />
          ) : overviewError ? (
            <ErrorState message={overviewError} onRetry={refresh} />
          ) : (
            <LoadingSkeleton className="h-[280px] w-full" />
          )}
        </section>

        <section className="panel p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="section-title">Jobs created vs. delivered</h2>
            <p className="section-caption">Daily activity for the selected date range</p>
          </div>
          <JobTrendsChart
            error={trendsError}
            loading={trendsLoading}
            onRetry={refreshTrends}
            trends={trends}
          />
        </section>
      </div>

      <section className="panel p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="section-title">Zone-wise delivery performance</h2>
          <p className="section-caption">Delivery completion rate by destination zone</p>
        </div>
        <ZonePerformanceChart
          error={zonesError}
          loading={zonesLoading}
          onRetry={refresh}
          zones={zones}
        />
      </section>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-6">
          <div>
            <h2 className="section-title">Recent activity</h2>
            <p className="section-caption">Latest audit events across your operation</p>
          </div>
          <span className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-muted">
            Latest 10 events
          </span>
        </div>
        {overview ? (
          <RecentActivityTable activities={overview.recentActivity} />
        ) : overviewError ? (
          <ErrorState message={overviewError} onRetry={refresh} />
        ) : (
          <LoadingSkeleton className="m-5 h-48" />
        )}
      </section>
    </div>
  );
}
