import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  Eye,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import DataTable, { type Column } from "../components/ui/DataTable";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import LoadingSkeleton from "../components/ui/LoadingSkeleton";
import Pagination from "../components/ui/Pagination";
import SearchFilter from "../components/ui/SearchFilter";
import StatusBadge from "../components/ui/StatusBadge";
import { useToast } from "../components/ui/Toast";
import { getApiError } from "../services/apiClient";
import {
  dismissManualQueueJob,
  fetchManualQueue,
  fetchManualQueueJob,
  fetchZones,
  retryManualQueueJob,
  type ZoneOption,
} from "../services/jobsService";
import type {
  JobPriority,
  JobRecommendations,
  JobEvent,
  ManualQueueAssignmentAttempt,
  ManualQueueJob,
  ManualQueueJobDetails,
  PaginatedResponse,
} from "../types/api";

const priorities: JobPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const pageSize = 20;

function formatLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null) {
  if (!value) return "No deadline";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDeadline(value: string | null) {
  if (!value) return { label: "No deadline", className: "text-muted", warning: false };
  const remaining = new Date(value).getTime() - Date.now();
  if (remaining < 0) {
    return { label: `Overdue · ${formatDate(value)}`, className: "font-semibold text-rose-700", warning: true };
  }
  if (remaining <= 60 * 60_000) {
    return { label: `Due soon · ${formatDate(value)}`, className: "font-semibold text-amber-700", warning: true };
  }
  return { label: formatDate(value), className: "text-ink", warning: false };
}

function priorityColor(priority: JobPriority) {
  if (priority === "URGENT") return "bg-rose-500";
  if (priority === "HIGH") return "bg-orange-500";
  if (priority === "NORMAL") return "bg-blue-500";
  return "bg-slate-400";
}

function isActiveAssignment(assignment: ManualQueueAssignmentAttempt) {
  return (
    (assignment.status === "PENDING" || assignment.status === "ACCEPTED") &&
    assignment.capacityReserved
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eventAssignmentId(details: unknown) {
  if (!isRecord(details)) return undefined;
  return typeof details.assignmentId === "string" ? details.assignmentId : undefined;
}

function timeoutReason(
  assignmentId: string,
  events: JobEvent[],
) {
  const timeoutEvent = events.find(
    (event) =>
      event.eventType === "ASSIGNMENT_EXPIRED" &&
      eventAssignmentId(event.details) === assignmentId,
  );
  return timeoutEvent?.description ??
    "The rider did not confirm the assignment before its deadline.";
}

export default function ManualQueuePage() {
  const { notify } = useToast();
  const navigate = useNavigate();
  const [queue, setQueue] = useState<PaginatedResponse<ManualQueueJob> | null>(null);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<JobPriority | "">("");
  const [pickupZoneId, setPickupZoneId] = useState("");
  const [deliveryZoneId, setDeliveryZoneId] = useState("");
  const [page, setPage] = useState(1);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [zonesError, setZonesError] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [details, setDetails] = useState<ManualQueueJobDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [detailsRefreshIndex, setDetailsRefreshIndex] = useState(0);
  const [retryResult, setRetryResult] = useState<JobRecommendations | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [retrySuccess, setRetrySuccess] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState("");
  const [dismissError, setDismissError] = useState("");
  const [dismissing, setDismissing] = useState(false);
  const retryLock = useRef(false);
  const dismissLock = useRef(false);

  const jobs = queue?.data ?? [];
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const hasActiveAssignment = Boolean(
    details?.previousAssignmentHistory.some(isActiveAssignment),
  );

  useEffect(() => {
    let active = true;
    fetchZones()
      .then((result) => {
        if (active) {
          setZones(result);
          setZonesError("");
        }
      })
      .catch((error: unknown) => {
        if (active) setZonesError(getApiError(error).message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setListLoading(true);
    setListError("");
    fetchManualQueue({
      q: search.trim() || undefined,
      priority: priority || undefined,
      pickupZoneId: pickupZoneId || undefined,
      deliveryZoneId: deliveryZoneId || undefined,
      page,
      pageSize,
    })
      .then((result) => {
        if (active) setQueue(result);
      })
      .catch((error: unknown) => {
        if (active) setListError(getApiError(error).message);
      })
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search, priority, pickupZoneId, deliveryZoneId, page, refreshIndex]);

  useEffect(() => {
    setPage(1);
  }, [search, priority, pickupZoneId, deliveryZoneId]);

  useEffect(() => {
    if (!queue) {
      setSelectedJobId(null);
      return;
    }
    const firstJob = queue.data[0];
    setSelectedJobId((current) =>
      current && queue.data.some((job) => job.id === current)
        ? current
        : firstJob?.id ?? null,
    );
  }, [queue]);

  useEffect(() => {
    if (!selectedJobId) {
      setDetails(null);
      setDetailsError("");
      setRetryResult(null);
      setRetryError("");
      setRetrySuccess(false);
      return;
    }
    let active = true;
    setDetails(null);
    setDetailsLoading(true);
    setDetailsError("");
    setRetryResult(null);
    setRetryError("");
    setRetrySuccess(false);
    fetchManualQueueJob(selectedJobId)
      .then((result) => {
        if (active) setDetails(result);
      })
      .catch((error: unknown) => {
        if (active) setDetailsError(getApiError(error).message);
      })
      .finally(() => {
        if (active) setDetailsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedJobId, detailsRefreshIndex]);

  const columns = useMemo<Column<ManualQueueJob>[]>(() => [
    {
      key: "orderReference",
      header: "Order reference",
      render: (job) => (
        <button
          aria-label={`View ${job.orderReference}`}
          className={`font-semibold hover:underline ${selectedJobId === job.id ? "text-ink" : "text-brand"}`}
          onClick={() => setSelectedJobId(job.id)}
          type="button"
        >
          {job.orderReference}
        </button>
      ),
    },
    { key: "pickup", header: "Pickup zone", render: (job) => job.pickupZone.name },
    { key: "delivery", header: "Delivery zone", render: (job) => job.deliveryZone.name },
    {
      key: "priority",
      header: "Priority",
      render: (job) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span className={`h-2 w-2 rounded-full ${priorityColor(job.priority)}`} />
          <StatusBadge value={job.priority} />
        </span>
      ),
    },
    {
      key: "deadline",
      header: "Deadline",
      render: (job) => {
        const deadline = formatDeadline(job.deadline);
        return (
          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${deadline.className}`}>
            {deadline.warning ? <AlertTriangle size={14} /> : <Clock3 size={14} />}
            {deadline.label}
          </span>
        );
      },
    },
    {
      key: "attempts",
      header: "Attempts",
      render: (job) => job.assignmentAttemptCount,
    },
    {
      key: "actions",
      header: "Actions",
      className: "whitespace-nowrap",
      render: (job) => (
        <button
          aria-label={`View details for ${job.orderReference}`}
          className="icon-button"
          onClick={() => setSelectedJobId(job.id)}
          title="View details"
          type="button"
        >
          <Eye size={16} />
        </button>
      ),
    },
  ], [selectedJobId]);

  async function retryRecommendations() {
    if (!selectedJobId || retryLock.current) return;
    retryLock.current = true;
    setRetrying(true);
    setRetryError("");
    setRetrySuccess(false);
    try {
      const result = await retryManualQueueJob(selectedJobId);
      setRetryResult(result);
      setRetrySuccess(true);
      notify("Rider recommendations refreshed.");
    } catch (error: unknown) {
      const message = getApiError(error).message;
      setRetryError(message);
      notify(message, "error");
    } finally {
      setRetrying(false);
      retryLock.current = false;
    }
  }

  async function dismissSelectedJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJobId || !dismissReason.trim() || dismissLock.current) return;
    dismissLock.current = true;
    setDismissing(true);
    setDismissError("");
    try {
      await dismissManualQueueJob(selectedJobId, dismissReason.trim());
      const previousTotal = queue?.pagination.total ?? 1;
      setQueue((current) => {
        if (!current) return current;
        const data = current.data.filter((job) => job.id !== selectedJobId);
        const total = Math.max(0, current.pagination.total - 1);
        return {
          data,
          pagination: {
            ...current.pagination,
            total,
            totalPages: Math.ceil(total / current.pagination.pageSize),
          },
        };
      });
      setDismissOpen(false);
      setDismissReason("");
      setSelectedJobId(null);
      setRefreshIndex((current) => current + 1);
      if (previousTotal > 0 && jobs.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      }
      notify("Job dismissed from the manual queue.");
    } catch (error: unknown) {
      const message = getApiError(error).message;
      setDismissError(message);
      notify(message, "error");
    } finally {
      setDismissing(false);
      dismissLock.current = false;
    }
  }

  const displayedRecommendations: JobRecommendations | null = details
    ? retryResult?.jobId === details.id
      ? retryResult
      : {
          jobId: details.id,
          recommendations: details.recommendations,
          excludedRiders: details.excludedRiders,
        }
    : null;

  return (
    <div className="space-y-5">
      <section className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-title">Manual queue</h2>
            <p className="section-caption">
              Review jobs that need dispatcher attention and retry rider recommendations.
            </p>
          </div>
          <button
            className="button-secondary"
            disabled={listLoading}
            onClick={() => setRefreshIndex((current) => current + 1)}
            type="button"
          >
            <RefreshCw className={listLoading ? "animate-spin" : ""} size={16} />
            Refresh queue
          </button>
        </div>
      </section>

      {zonesError && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          Zone filters could not be loaded: {zonesError}
        </p>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <section className="panel overflow-hidden">
          <div className="space-y-4 border-b border-line p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="section-title">Queued jobs</h2>
                <p className="section-caption">
                  {queue?.pagination.total.toLocaleString() ?? "—"} jobs · highest priority first
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SearchFilter
                onChange={setSearch}
                placeholder="Search order reference"
                value={search}
              />
              <label className="sr-only" htmlFor="manual-queue-priority-filter">Filter by priority</label>
              <select
                className="input"
                id="manual-queue-priority-filter"
                onChange={(event) => setPriority(event.target.value as JobPriority | "")}
                value={priority}
              >
                <option value="">All priorities</option>
                {priorities.map((value) => (
                  <option key={value} value={value}>{formatLabel(value)}</option>
                ))}
              </select>
              <label className="sr-only" htmlFor="manual-queue-pickup-filter">Filter by pickup zone</label>
              <select
                className="input"
                id="manual-queue-pickup-filter"
                onChange={(event) => setPickupZoneId(event.target.value)}
                value={pickupZoneId}
              >
                <option value="">All pickup zones</option>
                {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
              </select>
              <label className="sr-only" htmlFor="manual-queue-delivery-filter">Filter by delivery zone</label>
              <select
                className="input"
                id="manual-queue-delivery-filter"
                onChange={(event) => setDeliveryZoneId(event.target.value)}
                value={deliveryZoneId}
              >
                <option value="">All delivery zones</option>
                {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
              </select>
            </div>
          </div>

          {listError && !queue ? (
            <ErrorState
              message={listError}
              onRetry={() => setRefreshIndex((current) => current + 1)}
            />
          ) : listLoading && !queue ? (
            <div aria-label="Loading manual queue" className="space-y-3 p-5" role="status">
              {Array.from({ length: 5 }, (_, index) => (
                <LoadingSkeleton className="h-12" key={index} />
              ))}
            </div>
          ) : (
            <>
              {listError && queue && (
                <p className="px-5 py-3 text-sm text-rose-700" role="alert">
                  {listError} Showing the last loaded queue.
                </p>
              )}
              {listLoading && queue && (
                <div className="px-5 pt-4" role="status">
                  <LoadingSkeleton className="h-1.5" />
                </div>
              )}
              <DataTable
                columns={columns}
                emptyDescription={search || priority || pickupZoneId || deliveryZoneId
                  ? "Try changing or clearing the selected filters."
                  : "Jobs appear here when they need dispatcher attention."}
                emptyTitle={search || priority || pickupZoneId || deliveryZoneId
                  ? "No matching jobs"
                  : "The manual queue is clear"}
                rows={jobs}
              />
              {queue && queue.pagination.totalPages > 0 && (
                <Pagination
                  onChange={setPage}
                  page={page}
                  totalPages={queue.pagination.totalPages}
                />
              )}
            </>
          )}
        </section>

        <section className="panel min-h-[480px] overflow-hidden">
          {!selectedJob ? (
            <EmptyState
              title="Select a queued job"
              description="Choose a manual queue entry to review assignment attempts and rider eligibility."
            />
          ) : detailsLoading ? (
            <div aria-label="Loading job details" className="space-y-4 p-5" role="status">
              <LoadingSkeleton className="h-24" />
              <LoadingSkeleton className="h-36" />
              <LoadingSkeleton className="h-40" />
            </div>
          ) : detailsError || !details ? (
            <ErrorState
              message={detailsError || "Job details are not available."}
              onRetry={() => setDetailsRefreshIndex((current) => current + 1)}
            />
          ) : (
            <>
              <div className="border-b border-line p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Manual queue job</p>
                    <h2 className="mt-1 break-words text-lg font-semibold text-ink">{details.orderReference}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {details.pickupZone.name} <span className="text-slate-400">→</span> {details.deliveryZone.name}
                    </p>
                  </div>
                  <StatusBadge value={details.status} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Summary label="Priority" value={<StatusBadge value={details.priority} />} />
                  <Summary label="Required capacity" value={details.requiredCapacity.toLocaleString()} />
                  <Summary
                    label="Deadline"
                    value={<span className={formatDeadline(details.deadline).className}>{formatDeadline(details.deadline).label}</span>}
                  />
                  <Summary
                    label="Time in queue"
                    value={formatQueueDuration(details.timeInQueueMs)}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="button-primary"
                    onClick={() => navigate(`/assignments?jobId=${encodeURIComponent(details.id)}`)}
                    type="button"
                  >
                    <ArrowRight size={16} /> Open assignment workflow
                  </button>
                  <button
                    className="button-secondary"
                    disabled={retrying}
                    onClick={() => { void retryRecommendations(); }}
                    type="button"
                  >
                    <RotateCw className={retrying ? "animate-spin" : ""} size={16} />
                    {retrying ? "Retrying…" : "Retry recommendations"}
                  </button>
                  <button
                    className="button-secondary text-rose-700 hover:bg-rose-50"
                    disabled={hasActiveAssignment}
                    onClick={() => {
                      setDismissReason("");
                      setDismissError("");
                      setDismissOpen(true);
                    }}
                    title={hasActiveAssignment ? "A job with an active assignment cannot be dismissed." : "Dismiss this job"}
                    type="button"
                  >
                    <X size={16} /> Dismiss job
                  </button>
                </div>
                {hasActiveAssignment && (
                  <p className="mt-2 text-xs text-amber-800">
                    This job has an active assignment and cannot be dismissed.
                  </p>
                )}
              </div>

              <div className="space-y-6 p-4 sm:p-5">
                {retryError && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800" role="alert">
                    {retryError}
                  </p>
                )}
                {retrySuccess && (
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800" role="status">
                    Recommendations refreshed successfully.
                  </p>
                )}
                <section>
                  <div className="mb-3">
                    <h3 className="section-title">Rider recommendations</h3>
                    <p className="section-caption">Eligible riders are ranked; excluded riders include the backend eligibility reason.</p>
                  </div>
                  {retrying ? (
                    <div className="space-y-3" role="status">
                      <LoadingSkeleton className="h-24" />
                      <LoadingSkeleton className="h-24" />
                    </div>
                  ) : !displayedRecommendations ? (
                    <EmptyState title="Recommendations unavailable" description="Retry recommendations to check current rider eligibility." />
                  ) : displayedRecommendations.recommendations.length === 0 ? (
                    <EmptyState title="No eligible riders" description="No riders currently meet the eligibility requirements for this job." />
                  ) : (
                    <ol className="space-y-3">
                      {displayedRecommendations.recommendations.map((rider, index) => (
                        <li className={`rounded-xl border p-4 ${index === 0 ? "border-brand bg-emerald-50/40" : "border-line bg-white"}`} key={rider.riderId}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${index === 0 ? "bg-brand text-white" : "bg-slate-100 text-slate-700"}`}>
                                  {index + 1}
                                </span>
                                <h4 className="font-semibold text-ink">{rider.riderName}</h4>
                                {index === 0 && (
                                  <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                                    Top recommendation
                                  </span>
                                )}
                              </div>
                              <p className="mt-2 text-xs text-muted">
                                Score {rider.score.toFixed(1)} · {rider.workload} active assignment{rider.workload === 1 ? "" : "s"} · {rider.remainingCapacity}/{rider.maxCapacity} capacity remaining
                              </p>
                            </div>
                            <p className="text-xs font-medium text-muted">~{rider.estimatedTravelTime} min travel</p>
                          </div>
                          <ul className="mt-3 space-y-1 text-xs text-muted">
                            {rider.reasons.length > 0
                              ? rider.reasons.map((reason, reasonIndex) => <li key={`${rider.riderId}-${reasonIndex}`}>• {reason}</li>)
                              : <li>No additional explanation provided.</li>}
                          </ul>
                        </li>
                      ))}
                    </ol>
                  )}

                  {displayedRecommendations?.excludedRiders.length ? (
                    <details className="mt-4 rounded-lg border border-line px-4 py-3">
                      <summary className="cursor-pointer text-sm font-medium text-ink">
                        Excluded riders · {displayedRecommendations.excludedRiders.length}
                      </summary>
                      <ul className="mt-3 space-y-2">
                        {displayedRecommendations.excludedRiders.map((rider) => (
                          <li className="flex flex-wrap justify-between gap-2 text-xs" key={rider.riderId}>
                            <span className="font-medium text-ink">{rider.riderName}</span>
                            <span className="text-muted">{rider.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </section>

                <section>
                  <div className="mb-3">
                    <h3 className="section-title">Previous assignment attempts</h3>
                    <p className="section-caption">{details.assignmentAttemptCount} attempt{details.assignmentAttemptCount === 1 ? "" : "s"} recorded.</p>
                  </div>
                  {details.previousAssignmentHistory.length === 0 ? (
                    <EmptyState title="No assignment attempts" description="This job has not had a rider assignment attempt yet." />
                  ) : (
                    <ol className="space-y-3">
                      {details.previousAssignmentHistory.map((assignment) => (
                        <li className="rounded-lg border border-line p-3" key={assignment.id}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-ink">{assignment.rider.name}</p>
                              <p className="mt-1 text-xs text-muted">Assigned {formatDate(assignment.assignedAt)}</p>
                            </div>
                            <StatusBadge value={assignment.status} />
                          </div>
                          {assignment.rejectionReason && (
                            <p className="mt-2 text-sm text-rose-800">
                              Rejection reason: {assignment.rejectionReason}
                            </p>
                          )}
                          {assignment.status === "EXPIRED" && (
                            <p className="mt-2 text-sm text-amber-900">
                              Timeout reason: {timeoutReason(assignment.id, details.events)}
                            </p>
                          )}
                          {assignment.expiredAt && (
                            <p className="mt-1 text-xs text-muted">Expired {formatDate(assignment.expiredAt)}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                <section>
                  <h3 className="section-title">Queue activity</h3>
                  {details.events.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">No queue events have been recorded.</p>
                  ) : (
                    <ol className="mt-3 space-y-3 border-l border-line pl-4">
                      {details.events.map((event) => (
                        <li className="relative" key={event.id}>
                          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
                          <p className="text-sm font-medium text-ink">{event.description}</p>
                          <p className="mt-1 text-xs text-muted">
                            {formatLabel(event.eventType)} · {formatDate(event.createdAt)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            </>
          )}
        </section>
      </div>

      {dismissOpen && selectedJob && (
        <DismissDialog
          error={dismissError}
          onClose={() => {
            if (!dismissing) setDismissOpen(false);
          }}
          onReasonChange={setDismissReason}
          onSubmit={(event) => { void dismissSelectedJob(event); }}
          reason={dismissReason}
          submitting={dismissing}
          job={selectedJob}
        />
      )}
    </div>
  );
}

function formatQueueDuration(milliseconds: number) {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours} hr ${remainingMinutes} min`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ${hours % 24} hr`;
}

function Summary({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function DismissDialog({
  job,
  reason,
  error,
  submitting,
  onReasonChange,
  onClose,
  onSubmit,
}: {
  job: ManualQueueJob;
  reason: string;
  error: string;
  submitting: boolean;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onClose}>
      <section
        aria-labelledby="manual-queue-dismiss-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink" id="manual-queue-dismiss-title">Dismiss job from manual queue?</h2>
            <p className="mt-1 text-sm text-muted">{job.orderReference} · This will cancel the job.</p>
          </div>
          <button aria-label="Close dialog" className="icon-button" disabled={submitting} onClick={onClose} type="button">
            <X size={17} />
          </button>
        </div>
        <form className="space-y-4 p-5" onSubmit={onSubmit}>
          <label className="block text-sm font-medium text-ink">
            Dismissal reason <span className="text-rose-700">*</span>
            <textarea
              autoFocus
              className="input mt-1.5 min-h-28 resize-y py-2.5"
              maxLength={500}
              onChange={(event) => onReasonChange(event.target.value)}
              required
              value={reason}
            />
            <span className="mt-1 block text-xs font-normal text-muted">{reason.length}/500 characters · required</span>
          </label>
          {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <button className="button-secondary" disabled={submitting} onClick={onClose} type="button">Keep job</button>
            <button
              className="button-primary bg-rose-700 hover:bg-rose-800"
              disabled={submitting || !reason.trim()}
              type="submit"
            >
              {submitting && <LoaderCircle className="animate-spin" size={16} />}
              {submitting ? "Dismissing…" : "Dismiss job"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
