import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
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
  fetchAuditLog,
  fetchAuditLogs,
  fetchJobTimeline,
  fetchJobs,
  type AuditLogQuery,
} from "../services/jobsService";
import type {
  AuditEvent,
  Job,
  JobTimeline,
} from "../types/api";

const pageSize = 20;

const lifecycleStages = [
  { label: "Created", eventTypes: ["JOB_CREATED"] },
  { label: "Assigned", eventTypes: ["ASSIGNMENT_CREATED", "ASSIGNMENT_REASSIGNED"] },
  { label: "Accepted", eventTypes: ["ASSIGNMENT_ACCEPTED"] },
  { label: "Picked up", eventTypes: ["JOB_PICKED_UP"] },
  { label: "Delivered", eventTypes: ["JOB_DELIVERED"] },
];

const notableLifecycleEvents = new Set([
  "ASSIGNMENT_REJECTED",
  "ASSIGNMENT_REASSIGNED",
  "ASSIGNMENT_EXPIRED",
  "JOB_CANCELLED",
]);

function formatLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function toQueryDate(value: string, endOfDay: boolean) {
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  return new Date(`${value}T${time}`).toISOString();
}

function getErrorMessage(error: unknown) {
  return getApiError(error).message;
}

export default function AuditHistoryPage() {
  const { notify } = useToast();
  const [auditPage, setAuditPage] = useState<{
    data: AuditEvent[];
    pagination: { total: number; totalPages: number };
  } | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("");
  const [actor, setActor] = useState("");
  const [entityType, setEntityType] = useState<"" | "JOB" | "ASSIGNMENT">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventDetails, setEventDetails] = useState<AuditEvent | null>(null);
  const [eventDetailsLoading, setEventDetailsLoading] = useState(false);
  const [eventDetailsError, setEventDetailsError] = useState("");
  const [eventDetailsRefresh, setEventDetailsRefresh] = useState(0);
  const [timelineSearch, setTimelineSearch] = useState("");
  const [timelineJobs, setTimelineJobs] = useState<Job[]>([]);
  const [timelineJobId, setTimelineJobId] = useState("");
  const [timelineJob, setTimelineJob] = useState<Job | null>(null);
  const [timeline, setTimeline] = useState<JobTimeline | null>(null);
  const [timelineSearchLoading, setTimelineSearchLoading] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [timelineSearchError, setTimelineSearchError] = useState("");

  const dateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);
  const selectedEventFromPage = auditPage?.data.find(
    (event) => event.id === selectedEventId,
  ) ?? null;

  useEffect(() => {
    let active = true;
    if (dateRangeInvalid) {
      setListError("The start date must be on or before the end date.");
      setListLoading(false);
      return () => {
        active = false;
      };
    }

    setListLoading(true);
    setListError("");
    const query: Omit<AuditLogQuery, "page"> = {
      q: search.trim() || undefined,
      eventType: eventType.trim() || undefined,
      actor: actor.trim() || undefined,
      entityType: entityType || undefined,
      from: fromDate ? toQueryDate(fromDate, false) : undefined,
      to: toDate ? toQueryDate(toDate, true) : undefined,
      pageSize,
    };

    async function loadChronologicalPage() {
      const newestPage = await fetchAuditLogs({ ...query, page: 1 });
      const totalPages = newestPage.pagination.totalPages;
      if (page > Math.max(totalPages, 1)) {
        if (active) setPage(Math.max(totalPages, 1));
        return;
      }

      const apiPage = Math.max(1, totalPages - page + 1);
      const result = apiPage === 1
        ? newestPage
        : await fetchAuditLogs({ ...query, page: apiPage });
      const chronologicalEvents = [...result.data].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
          left.id.localeCompare(right.id),
      );
      if (active) {
        setAuditPage({
          data: chronologicalEvents,
          pagination: {
            total: result.pagination.total,
            totalPages: result.pagination.totalPages,
          },
        });
      }
    }

    loadChronologicalPage()
      .catch((error: unknown) => {
        if (active) setListError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setListLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    search,
    eventType,
    actor,
    entityType,
    fromDate,
    toDate,
    dateRangeInvalid,
    page,
    refreshIndex,
  ]);

  useEffect(() => {
    setPage(1);
  }, [search, eventType, actor, entityType, fromDate, toDate]);

  useEffect(() => {
    if (!selectedEventId) {
      setEventDetails(null);
      setEventDetailsError("");
      return;
    }
    let active = true;
    setEventDetails(null);
    setEventDetailsLoading(true);
    setEventDetailsError("");
    fetchAuditLog(selectedEventId)
      .then((event) => {
        if (active) setEventDetails(event);
      })
      .catch((error: unknown) => {
        if (active) setEventDetailsError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setEventDetailsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedEventId, eventDetailsRefresh]);

  const columns = useMemo<Column<AuditEvent>[]>(() => [
    {
      key: "action",
      header: "Action",
      render: (event) => (
        <div className="space-y-1">
          <StatusBadge value={formatLabel(event.eventType)} />
          <p className="text-[11px] text-muted">{event.entityType}</p>
        </div>
      ),
    },
    {
      key: "timestamp",
      header: "Timestamp",
      render: (event) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
          <Clock3 size={14} className="text-muted" />
          {formatDate(event.createdAt)}
        </span>
      ),
    },
    { key: "actor", header: "Actor", render: (event) => event.actor },
    {
      key: "jobReference",
      header: "Job reference",
      render: (event) => (
        <span className="font-semibold text-ink">{event.job.orderReference}</span>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (event) => <span className="line-clamp-2 text-sm text-muted">{event.description}</span>,
    },
    {
      key: "details",
      header: "Details",
      className: "whitespace-nowrap",
      render: (event) => (
        <button
          aria-label={`View details for ${formatLabel(event.eventType)} on ${event.job.orderReference}`}
          className="icon-button"
          onClick={() => setSelectedEventId(event.id)}
          title="View event details"
          type="button"
        >
          <Eye size={16} />
        </button>
      ),
    },
  ], []);

  async function findTimelineJobs(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const query = timelineSearch.trim();
    if (!query) {
      setTimelineSearchError("Enter a job reference to search.");
      return;
    }
    setTimelineSearchLoading(true);
    setTimelineSearchError("");
    setTimelineError("");
    setTimeline(null);
    setTimelineJob(null);
    setTimelineJobId("");
    try {
      const result = await fetchJobs({ q: query, page: 1, pageSize: 20 });
      setTimelineJobs(result.data);
      const exactMatch = result.data.find(
        (job) => job.orderReference.toLocaleLowerCase() === query.toLocaleLowerCase(),
      );
      if (exactMatch) {
        setTimelineJobId(exactMatch.id);
      } else if (result.data.length === 0) {
        setTimelineSearchError("No matching job was found.");
      } else {
        setTimelineSearchError("Choose the matching job from the results.");
        if (result.data.length === 1) setTimelineJobId(result.data[0]!.id);
      }
    } catch (error: unknown) {
      setTimelineSearchError(getErrorMessage(error));
      setTimelineJobs([]);
    } finally {
      setTimelineSearchLoading(false);
    }
  }

  async function loadTimeline() {
    const job = timelineJobs.find((candidate) => candidate.id === timelineJobId);
    if (!job) {
      setTimelineSearchError("Select a job before loading its timeline.");
      return;
    }
    setTimelineLoading(true);
    setTimelineError("");
    try {
      const result = await fetchJobTimeline(job.id);
      setTimeline(result);
      setTimelineJob(job);
      setTimelineSearchError("");
      notify(`Lifecycle timeline loaded for ${job.orderReference}.`);
    } catch (error: unknown) {
      setTimelineError(getErrorMessage(error));
    } finally {
      setTimelineLoading(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setEventType("");
    setActor("");
    setEntityType("");
    setFromDate("");
    setToDate("");
  }

  const filtersApplied = Boolean(
    search || eventType || actor || entityType || fromDate || toDate,
  );
  const timelineEventTypes = new Set(timeline?.events.map((event) => event.eventType) ?? []);

  return (
    <div className="space-y-5">
      <section className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-title">Job history &amp; audit trail</h2>
            <p className="section-caption">
              Review operational events chronologically and inspect a job’s complete lifecycle.
            </p>
          </div>
          <button
            className="button-secondary"
            disabled={listLoading}
            onClick={() => setRefreshIndex((current) => current + 1)}
            type="button"
          >
            <RefreshCw className={listLoading ? "animate-spin" : ""} size={16} />
            Refresh history
          </button>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="space-y-4 border-b border-line p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="section-title">Audit events</h2>
              <p className="section-caption">
                {auditPage?.pagination.total.toLocaleString() ?? "—"} events · oldest first
              </p>
            </div>
            {filtersApplied && (
              <button className="button-secondary" onClick={clearFilters} type="button">
                <X size={15} /> Clear filters
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <SearchFilter
              onChange={setSearch}
              placeholder="Search job reference or ID"
              value={search}
            />
            <label className="sr-only" htmlFor="audit-event-type-filter">Filter by event type</label>
            <input
              className="input"
              id="audit-event-type-filter"
              onChange={(event) => setEventType(event.target.value)}
              placeholder="Event type (exact)"
              value={eventType}
            />
            <label className="sr-only" htmlFor="audit-actor-filter">Filter by actor</label>
            <input
              className="input"
              id="audit-actor-filter"
              onChange={(event) => setActor(event.target.value)}
              placeholder="Actor (exact)"
              value={actor}
            />
            <label className="sr-only" htmlFor="audit-entity-filter">Filter by entity type</label>
            <select
              className="input"
              id="audit-entity-filter"
              onChange={(event) => setEntityType(event.target.value as "" | "JOB" | "ASSIGNMENT")}
              value={entityType}
            >
              <option value="">All entity types</option>
              <option value="JOB">Job events</option>
              <option value="ASSIGNMENT">Assignment events</option>
            </select>
            <label className="relative block">
              <span className="sr-only">From date</span>
              <CalendarClock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
              <input
                aria-label="From date"
                className="input pl-10"
                max={toDate || undefined}
                onChange={(event) => setFromDate(event.target.value)}
                type="date"
                value={fromDate}
              />
            </label>
            <label className="relative block">
              <span className="sr-only">To date</span>
              <CalendarClock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
              <input
                aria-label="To date"
                className="input pl-10"
                min={fromDate || undefined}
                onChange={(event) => setToDate(event.target.value)}
                type="date"
                value={toDate}
              />
            </label>
          </div>
          <p className="text-xs text-muted">
            Search uses the existing API’s job-reference and entity-ID matching. Event type and actor filters use exact matches.
          </p>
        </div>

        {dateRangeInvalid && (
          <p className="px-5 py-3 text-sm text-rose-700" role="alert">
            The start date must be on or before the end date.
          </p>
        )}
        {listError && !auditPage ? (
          <ErrorState
            message={listError}
            onRetry={() => setRefreshIndex((current) => current + 1)}
          />
        ) : listLoading && !auditPage ? (
          <div aria-label="Loading audit events" className="space-y-3 p-5" role="status">
            {Array.from({ length: 5 }, (_, index) => (
              <LoadingSkeleton className="h-12" key={index} />
            ))}
          </div>
        ) : (
          <>
            {listError && auditPage && (
              <p className="px-5 py-3 text-sm text-rose-700" role="alert">
                {listError} Showing the last loaded events.
              </p>
            )}
            {listLoading && auditPage && (
              <div className="px-5 pt-4" role="status">
                <LoadingSkeleton className="h-1.5" />
              </div>
            )}
            <DataTable
              columns={columns}
              emptyDescription={filtersApplied
                ? "Try changing the filters or date range."
                : "Audit activity will appear here as jobs progress through dispatch."}
              emptyTitle={filtersApplied ? "No matching audit events" : "No audit events"}
              rows={auditPage?.data ?? []}
            />
            {auditPage && auditPage.pagination.totalPages > 0 && (
              <Pagination
                onChange={setPage}
                page={page}
                totalPages={auditPage.pagination.totalPages}
              />
            )}
          </>
        )}
      </section>

      <section className="panel overflow-hidden">
        <div className="border-b border-line p-4 sm:p-5">
          <h2 className="section-title">Job lifecycle timeline</h2>
          <p className="section-caption">
            Search by order reference to view creation, assignment, acceptance, pickup, delivery and intervening events.
          </p>
          <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { void findTimelineJobs(event); }}>
            <SearchFilter
              onChange={setTimelineSearch}
              placeholder="Find job by order reference"
              value={timelineSearch}
            />
            <button className="button-secondary" disabled={timelineSearchLoading || !timelineSearch.trim()} type="submit">
              {timelineSearchLoading
                ? <LoaderCircle className="animate-spin" size={16} />
                : <Search size={16} />}
              Find job
            </button>
            {timelineJobs.length > 0 && (
              <>
                <label className="sr-only" htmlFor="timeline-job-select">Select job</label>
                <select
                  className="input min-w-0 flex-1"
                  id="timeline-job-select"
                  onChange={(event) => setTimelineJobId(event.target.value)}
                  value={timelineJobId}
                >
                  <option value="">Select a job</option>
                  {timelineJobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.orderReference} · {formatLabel(job.status)}
                    </option>
                  ))}
                </select>
                <button className="button-primary" disabled={timelineLoading || !timelineJobId} onClick={() => { void loadTimeline(); }} type="button">
                  {timelineLoading && <LoaderCircle className="animate-spin" size={16} />}
                  Load timeline
                </button>
              </>
            )}
          </form>
          {timelineSearchError && (
            <p className="mt-3 text-sm text-rose-700" role="alert">{timelineSearchError}</p>
          )}
        </div>

        {timelineLoading ? (
          <div aria-label="Loading job timeline" className="space-y-3 p-5" role="status">
            <LoadingSkeleton className="h-20" />
            <LoadingSkeleton className="h-32" />
          </div>
        ) : timelineError ? (
          <ErrorState message={timelineError} onRetry={() => { void loadTimeline(); }} />
        ) : !timeline ? (
          <EmptyState
            title="Select a job to view its timeline"
            description="The complete lifecycle and audit events for the selected job will appear here."
          />
        ) : (
          <div className="space-y-5 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Lifecycle for</p>
                <h3 className="mt-1 text-base font-semibold text-ink">{timeline.orderReference}</h3>
              </div>
              {timelineJob && <StatusBadge value={timelineJob.status} />}
            </div>

            <ol aria-label="Job lifecycle stages" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {lifecycleStages.map((stage, index) => {
                const completed = stage.eventTypes.some((type) => timelineEventTypes.has(type));
                return (
                  <li className="flex items-center gap-2 rounded-lg border border-line p-3" key={stage.label}>
                    <span className={completed ? "text-brand" : "text-slate-300"}>
                      {completed ? <CheckCircle2 size={18} /> : <span className="grid h-[18px] w-[18px] place-items-center rounded-full border border-current text-[10px]">{index + 1}</span>}
                    </span>
                    <span className={`text-sm font-medium ${completed ? "text-ink" : "text-muted"}`}>{stage.label}</span>
                  </li>
                );
              })}
            </ol>

            {timeline.events.length === 0 ? (
              <EmptyState title="No timeline events" description="This job has no recorded lifecycle events." />
            ) : (
              <ol className="space-y-0 border-l border-line pl-5">
                {timeline.events.map((event) => {
                  const notable = notableLifecycleEvents.has(event.eventType);
                  return (
                    <li className="relative pb-5 last:pb-0" key={event.id}>
                      <span className={`absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 ${notable ? "border-amber-600 bg-amber-50" : "border-brand bg-white"}`} />
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge value={formatLabel(event.eventType)} />
                        {notable && <span className="text-[11px] font-medium text-amber-800">Additional lifecycle event</span>}
                      </div>
                      <p className="mt-2 text-sm font-medium text-ink">{event.description}</p>
                      <p className="mt-1 text-xs text-muted">
                        {formatDate(event.createdAt)} · {event.actor}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </section>

      {selectedEventId && (
        <AuditEventDialog
          error={eventDetailsError}
          event={eventDetails ?? selectedEventFromPage}
          loading={eventDetailsLoading}
          onClose={() => setSelectedEventId(null)}
          onRetry={() => setEventDetailsRefresh((current) => current + 1)}
        />
      )}
    </div>
  );
}

function AuditEventDialog({
  event,
  loading,
  error,
  onClose,
  onRetry,
}: {
  event: AuditEvent | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onClose}>
      <section
        aria-labelledby="audit-event-dialog-title"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl"
        onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink" id="audit-event-dialog-title">Audit event details</h2>
            {event && <p className="mt-1 text-sm text-muted">{event.job.orderReference}</p>}
          </div>
          <button aria-label="Close event details" className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </div>
        {loading && !event ? (
          <div aria-label="Loading event details" className="space-y-3 p-5" role="status">
            <LoadingSkeleton className="h-12" />
            <LoadingSkeleton className="h-28" />
          </div>
        ) : !event ? (
          <ErrorState
            message={error || "Audit event details could not be loaded."}
            onRetry={onRetry}
          />
        ) : (
          <div className="space-y-5 p-5">
            {error && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
                Full event details could not be refreshed: {error} Showing the event from the current page.
                {" "}
                <button className="font-semibold underline" onClick={onRetry} type="button">Retry</button>
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail label="Action" value={formatLabel(event.eventType)} />
              <Detail label="Timestamp" value={formatDate(event.createdAt)} />
              <Detail label="Actor" value={event.actor} />
              <Detail label="Job reference" value={event.job.orderReference} />
              <Detail label="Entity" value={`${event.entityType} · ${event.entityId}`} />
              {event.job.status && <Detail label="Job status" value={<StatusBadge value={event.job.status} />} />}
            </div>
            <section>
              <h3 className="text-sm font-semibold text-ink">Description</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{event.description}</p>
            </section>
            <section>
              <h3 className="text-sm font-semibold text-ink">Event payload</h3>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                {event.details === null
                  ? "No additional details."
                  : JSON.stringify(event.details, null, 2) ?? "No additional details."}
              </pre>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
