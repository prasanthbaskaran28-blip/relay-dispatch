import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Eye,
  LoaderCircle,
  Plus,
  Pencil,
  RotateCw,
  UserRound,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useToast } from "../components/ui/Toast";
import DataTable, { type Column } from "../components/ui/DataTable";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import LoadingSkeleton from "../components/ui/LoadingSkeleton";
import Pagination from "../components/ui/Pagination";
import SearchFilter from "../components/ui/SearchFilter";
import StatusBadge from "../components/ui/StatusBadge";
import { getApiError } from "../services/apiClient";
import {
  cancelJob,
  acceptAssignment,
  createAssignment,
  createJob,
  deliverJob,
  fetchJob,
  fetchJobAssignments,
  fetchJobAuditEvents,
  fetchJobTimeline,
  fetchJobs,
  fetchRecommendations,
  fetchRider,
  fetchZones,
  pickUpJob,
  rejectAssignment,
  updateJob,
  type CreateJobInput,
  type UpdateJobInput,
  type ZoneOption,
} from "../services/jobsService";
import type {
  Job,
  JobAssignment,
  JobAuditEvent,
  JobEvent,
  JobPriority,
  JobRecommendations,
  JobStatus,
  JobTimeline,
  Rider,
} from "../types/api";

const jobStatuses: JobStatus[] = [
  "NEW",
  "READY_FOR_ASSIGNMENT",
  "AWAITING_CONFIRMATION",
  "ACCEPTED",
  "PICKED_UP",
  "DELIVERED",
  "MANUAL_QUEUE",
  "CANCELLED",
];
const jobPriorities: JobPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const editableStatuses: JobStatus[] = ["NEW", "READY_FOR_ASSIGNMENT", "MANUAL_QUEUE"];
const cancellableStatuses: JobStatus[] = [
  "NEW",
  "READY_FOR_ASSIGNMENT",
  "AWAITING_CONFIRMATION",
  "ACCEPTED",
  "MANUAL_QUEUE",
];
const assignableStatuses: JobStatus[] = ["NEW", "READY_FOR_ASSIGNMENT", "MANUAL_QUEUE"];
const activeStatuses: JobStatus[] = [
  "NEW",
  "READY_FOR_ASSIGNMENT",
  "AWAITING_CONFIRMATION",
  "ACCEPTED",
  "PICKED_UP",
  "MANUAL_QUEUE",
];

function formatLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function toLocalDateTimeInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function deadlineLabel(job: Job) {
  if (!job.deadline) return { label: "No deadline", className: "text-muted" };
  const remaining = new Date(job.deadline).getTime() - Date.now();
  if (remaining < 0 && activeStatuses.includes(job.status)) {
    return { label: `Overdue · ${formatDate(job.deadline)}`, className: "font-semibold text-rose-700" };
  }
  if (activeStatuses.includes(job.status) && remaining <= 60 * 60_000) {
    return { label: `Due soon · ${formatDate(job.deadline)}`, className: "font-semibold text-amber-700" };
  }
  return { label: formatDate(job.deadline), className: "text-ink" };
}

function getErrorMessage(error: unknown) {
  return getApiError(error).message;
}

interface JobDetailBundle {
  job: Job & { events: JobEvent[] };
  assignments: Array<JobAssignment & { riderDetails: Rider }>;
  timeline: JobTimeline;
  auditEvents: JobAuditEvent[];
}

export default function JobsPage() {
  const { notify } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<JobPriority | "">("");
  const [pickupFilter, setPickupFilter] = useState("");
  const [deliveryFilter, setDeliveryFilter] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [zonesError, setZonesError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [cancellingJob, setCancellingJob] = useState<Job | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detailBundle, setDetailBundle] = useState<JobDetailBundle | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRefreshIndex, setDetailRefreshIndex] = useState(0);

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
        if (active) setZonesError(getErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setListLoading(true);
    setListError("");
    fetchJobs({
      q: search.trim() || undefined,
      status: statusFilter || undefined,
      priority: priorityFilter || undefined,
      pickupZoneId: pickupFilter || undefined,
      deliveryZoneId: deliveryFilter || undefined,
      page,
      pageSize,
    })
      .then((result) => {
        if (!active) return;
        setJobs(result.data);
        setTotal(result.pagination.total);
        setTotalPages(result.pagination.totalPages);
      })
      .catch((error: unknown) => {
        if (active) setListError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search, statusFilter, priorityFilter, pickupFilter, deliveryFilter, page, pageSize, refreshIndex]);

  useEffect(() => {
    if (!selectedJobId) {
      setDetailBundle(null);
      setDetailError("");
      return;
    }
    let active = true;
    setDetailBundle(null);
    setDetailLoading(true);
    setDetailError("");
    Promise.all([
      fetchJob(selectedJobId),
      fetchJobAssignments(selectedJobId),
      fetchJobTimeline(selectedJobId),
      fetchJobAuditEvents(selectedJobId),
    ])
      .then(async ([job, assignmentHistory, timeline, auditEvents]) => {
        const riderIds = [...new Set(assignmentHistory.map((assignment) => assignment.riderId))];
        const riderEntries = await Promise.all(
          riderIds.map(async (riderId) => [riderId, await fetchRider(riderId)] as const),
        );
        if (!active) return;
        const riders = new Map(riderEntries);
        setDetailBundle({
          job,
          assignments: assignmentHistory.map((assignment) => ({
            ...assignment,
            riderDetails: riders.get(assignment.riderId)!,
          })),
          timeline,
          auditEvents,
        });
      })
      .catch((error: unknown) => {
        if (active) setDetailError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedJobId, detailRefreshIndex]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, priorityFilter, pickupFilter, deliveryFilter]);

  const refresh = () => setRefreshIndex((current) => current + 1);
  const refreshDetails = () => setDetailRefreshIndex((current) => current + 1);
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("");
    setPriorityFilter("");
    setPickupFilter("");
    setDeliveryFilter("");
  };
  const filtersApplied = Boolean(search || statusFilter || priorityFilter || pickupFilter || deliveryFilter);

  const columns = useMemo<Column<Job>[]>(() => [
    {
      key: "orderReference",
      header: "Order reference",
      render: (job) => (
        <button className="font-semibold text-brand hover:underline" onClick={() => setSelectedJobId(job.id)} type="button">
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
          <span className={`h-2 w-2 rounded-full ${job.priority === "URGENT" ? "bg-rose-500" : job.priority === "HIGH" ? "bg-orange-500" : job.priority === "NORMAL" ? "bg-blue-500" : "bg-slate-400"}`} />
          <StatusBadge value={job.priority} />
        </span>
      ),
    },
    { key: "capacity", header: "Required capacity", render: (job) => job.requiredCapacity.toLocaleString() },
    { key: "status", header: "Job status", render: (job) => <StatusBadge value={job.status} /> },
    {
      key: "deadline",
      header: "Deadline",
      render: (job) => {
        const deadline = deadlineLabel(job);
        return (
          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${deadline.className}`}>
            {job.deadline && activeStatuses.includes(job.status) && new Date(job.deadline).getTime() - Date.now() <= 60 * 60_000
              ? <AlertTriangle size={14} />
              : <CalendarClock size={14} />}
            {deadline.label}
          </span>
        );
      },
    },
    { key: "createdAt", header: "Created date", render: (job) => formatDate(job.createdAt) },
    {
      key: "actions",
      header: "Actions",
      className: "whitespace-nowrap",
      render: (job) => (
        <div className="flex items-center gap-1">
          <button aria-label={`View ${job.orderReference}`} className="icon-button" onClick={() => setSelectedJobId(job.id)} title="View details" type="button"><Eye size={16} /></button>
          {editableStatuses.includes(job.status) && (
            <button aria-label={`Edit ${job.orderReference}`} className="icon-button" onClick={() => setEditingJob(job)} title="Edit job" type="button"><Pencil size={16} /></button>
          )}
          {cancellableStatuses.includes(job.status) && (
            <button aria-label={`Cancel ${job.orderReference}`} className="icon-button text-rose-700 hover:bg-rose-50" onClick={() => setCancellingJob(job)} title="Cancel job" type="button"><X size={16} /></button>
          )}
        </div>
      ),
    },
  ], []);

  const onSaved = () => {
    setCreateOpen(false);
    setEditingJob(null);
    notify(editingJob ? "Job updated." : "Job created.");
    refresh();
    if (selectedJobId) refreshDetails();
  };

  const onCancelled = () => {
    setCancellingJob(null);
    notify("Job cancelled.");
    refresh();
    if (selectedJobId) refreshDetails();
  };

  const onAssigned = () => {
    notify("Rider assignment created.");
    refresh();
    refreshDetails();
  };

  const onLifecycleChanged = (message: string) => {
    notify(message);
    refresh();
    refreshDetails();
  };

  return (
    <div className="space-y-5">
      <section className="panel p-4 sm:p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="section-title">Delivery jobs</h2>
              <p className="section-caption">{total.toLocaleString()} jobs · newest first</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="button-secondary" disabled={listLoading} onClick={refresh} type="button">
                <RotateCw className={listLoading ? "animate-spin" : ""} size={16} /> Refresh
              </button>
              <button className="button-primary" onClick={() => setCreateOpen(true)} type="button">
                <Plus size={17} /> Create job
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SearchFilter onChange={setSearch} placeholder="Search order reference" value={search} />
            <label className="sr-only" htmlFor="job-status-filter">Filter by status</label>
            <select className="input" id="job-status-filter" onChange={(event) => setStatusFilter(event.target.value as JobStatus | "")} value={statusFilter}>
              <option value="">All statuses</option>
              {jobStatuses.map((status) => <option key={status} value={status}>{formatLabel(status)}</option>)}
            </select>
            <label className="sr-only" htmlFor="job-priority-filter">Filter by priority</label>
            <select className="input" id="job-priority-filter" onChange={(event) => setPriorityFilter(event.target.value as JobPriority | "")} value={priorityFilter}>
              <option value="">All priorities</option>
              {jobPriorities.map((priority) => <option key={priority} value={priority}>{formatLabel(priority)}</option>)}
            </select>
            <label className="sr-only" htmlFor="job-pickup-filter">Filter by pickup zone</label>
            <select className="input" id="job-pickup-filter" onChange={(event) => setPickupFilter(event.target.value)} value={pickupFilter}>
              <option value="">All pickup zones</option>
              {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
            </select>
            <label className="sr-only" htmlFor="job-delivery-filter">Filter by delivery zone</label>
            <select className="input" id="job-delivery-filter" onChange={(event) => setDeliveryFilter(event.target.value)} value={deliveryFilter}>
              <option value="">All delivery zones</option>
              {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
            </select>
          </div>
          {filtersApplied && (
            <div className="flex justify-end">
              <button className="text-sm font-medium text-brand hover:underline" onClick={clearFilters} type="button">Clear filters</button>
            </div>
          )}
          {zonesError && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Zone choices could not be loaded: {zonesError}
            </p>
          )}
        </div>
      </section>

      <section className="panel overflow-hidden">
        {listError && jobs.length === 0 ? (
          <ErrorState message={listError} onRetry={refresh} />
        ) : listLoading && jobs.length === 0 ? (
          <div aria-label="Loading jobs" className="space-y-3 p-5" role="status">
            {Array.from({ length: 6 }, (_, index) => <LoadingSkeleton className="h-12" key={index} />)}
          </div>
        ) : listError ? (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
            {listError} Showing the last loaded results.
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState title="No delivery jobs found" description="Create a job or adjust your search and filters." />
        ) : (
          <DataTable columns={columns} rows={jobs} />
        )}
        {!listError && jobs.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
            <p className="text-sm text-muted">
              Showing {((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()} jobs
            </p>
            <Pagination onChange={setPage} page={page} totalPages={totalPages} />
          </div>
        )}
      </section>

      {(createOpen || editingJob) && (
        <JobFormDialog
          job={editingJob ?? undefined}
          onClose={() => {
            setCreateOpen(false);
            setEditingJob(null);
          }}
          onSaved={onSaved}
          zones={zones}
          zonesError={zonesError}
        />
      )}
      {cancellingJob && (
        <CancelJobDialog
          job={cancellingJob}
          onCancel={() => setCancellingJob(null)}
          onCancelled={onCancelled}
        />
      )}
      {selectedJobId && (
        <JobDetailsDialog
          bundle={detailBundle}
          error={detailError}
          loading={detailLoading}
          onAssigned={onAssigned}
          onCancelJob={(job) => setCancellingJob(job)}
          onClose={() => setSelectedJobId(null)}
          onEditJob={(job) => setEditingJob(job)}
          onLifecycleChanged={onLifecycleChanged}
          onRetry={refreshDetails}
        />
      )}
    </div>
  );
}

function DialogFrame({
  children,
  onClose,
  title,
  width = "max-w-2xl",
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 sm:p-6" onMouseDown={onClose}>
      <section
        aria-labelledby="job-dialog-title"
        aria-modal="true"
        className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-xl bg-white shadow-xl`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-5 py-4">
          <h2 className="text-lg font-semibold text-ink" id="job-dialog-title">{title}</h2>
          <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function JobFormDialog({
  job,
  zones,
  zonesError,
  onClose,
  onSaved,
}: {
  job?: Job;
  zones: ZoneOption[];
  zonesError: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(job);
  const [orderReference, setOrderReference] = useState(job?.orderReference ?? "");
  const [pickupZoneId, setPickupZoneId] = useState(job?.pickupZoneId ?? "");
  const [deliveryZoneId, setDeliveryZoneId] = useState(job?.deliveryZoneId ?? "");
  const [requiredCapacity, setRequiredCapacity] = useState(String(job?.requiredCapacity ?? ""));
  const [priority, setPriority] = useState<JobPriority>(job?.priority ?? "NORMAL");
  const [deadline, setDeadline] = useState(toLocalDateTimeInput(job?.deadline ?? null));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFieldErrors({});
    const capacity = Number(requiredCapacity);
    const errors: Record<string, string> = {};
    if (!pickupZoneId) errors.pickupZoneId = "Choose a pickup zone.";
    if (!deliveryZoneId) errors.deliveryZoneId = "Choose a delivery zone.";
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100_000) {
      errors.requiredCapacity = "Enter a whole number from 1 to 100,000.";
    }
    if (!editing && !orderReference.trim()) errors.orderReference = "Order reference is required.";
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const deadlineValue = deadline ? new Date(deadline).toISOString() : null;
      if (job) {
        const input: UpdateJobInput = {
          pickupZoneId,
          deliveryZoneId,
          requiredCapacity: capacity,
          priority,
          deadline: deadlineValue,
        };
        await updateJob(job.id, input);
      } else {
        const input: CreateJobInput = {
          orderReference: orderReference.trim(),
          pickupZoneId,
          deliveryZoneId,
          requiredCapacity: capacity,
          priority,
          deadline: deadlineValue,
          idempotencyKey: crypto.randomUUID(),
        };
        await createJob(input);
      }
      onSaved();
    } catch (error) {
      const apiError = getApiError(error);
      if (apiError.code === "ORDER_REFERENCE_EXISTS") {
        setFieldErrors({ orderReference: apiError.message });
      } else {
        for (const detail of apiError.details) {
          setFieldErrors((current) => ({ ...current, [detail.field]: detail.message }));
        }
      }
      setFormError(apiError.details.length > 0 ? "Review the highlighted fields." : apiError.message);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (name: string) => fieldErrors[name] && (
    <p className="mt-1 text-xs text-rose-700" role="alert">{fieldErrors[name]}</p>
  );

  return (
    <DialogFrame onClose={onClose} title={editing ? `Edit ${job?.orderReference}` : "Create delivery job"}>
      <form className="space-y-5 p-5" onSubmit={submit}>
        {formError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{formError}</p>}
        {!editing && (
          <label className="block text-sm font-medium text-ink">
            Order reference <span className="text-rose-700">*</span>
            <input autoComplete="off" className="input mt-1.5" maxLength={100} onChange={(event) => setOrderReference(event.target.value)} required value={orderReference} />
            {fieldError("orderReference")}
          </label>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-ink">
            Pickup zone <span className="text-rose-700">*</span>
            <select className="input mt-1.5" onChange={(event) => setPickupZoneId(event.target.value)} required value={pickupZoneId}>
              <option value="">Select pickup zone</option>
              {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
            </select>
            {fieldError("pickupZoneId")}
          </label>
          <label className="block text-sm font-medium text-ink">
            Delivery zone <span className="text-rose-700">*</span>
            <select className="input mt-1.5" onChange={(event) => setDeliveryZoneId(event.target.value)} required value={deliveryZoneId}>
              <option value="">Select delivery zone</option>
              {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
            </select>
            {fieldError("deliveryZoneId")}
          </label>
        </div>
        {zonesError && <p className="text-sm text-rose-700" role="alert">Zone list unavailable: {zonesError}</p>}
        {!zonesError && zones.length === 0 && <p className="text-sm text-muted">No zones are available. Refresh the page after zones have been configured.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-ink">
            Required capacity <span className="text-rose-700">*</span>
            <input className="input mt-1.5" max="100000" min="1" onChange={(event) => setRequiredCapacity(event.target.value)} required type="number" value={requiredCapacity} />
            {fieldError("requiredCapacity")}
          </label>
          <label className="block text-sm font-medium text-ink">
            Priority <span className="text-rose-700">*</span>
            <select className="input mt-1.5" onChange={(event) => setPriority(event.target.value as JobPriority)} required value={priority}>
              {jobPriorities.map((option) => <option key={option} value={option}>{formatLabel(option)}</option>)}
            </select>
            {fieldError("priority")}
          </label>
        </div>
        <label className="block text-sm font-medium text-ink">
          Deadline <span className="font-normal text-muted">(optional)</span>
          <input className="input mt-1.5" onChange={(event) => setDeadline(event.target.value)} type="datetime-local" value={deadline} />
          {fieldError("deadline")}
        </label>
        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <button className="button-secondary" disabled={submitting} onClick={onClose} type="button">Close</button>
          <button className="button-primary" disabled={submitting || zones.length === 0} type="submit">
            {submitting && <LoaderCircle className="animate-spin" size={16} />}
            {submitting ? "Saving…" : editing ? "Save changes" : "Create job"}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

function CancelJobDialog({
  job,
  onCancel,
  onCancelled,
}: {
  job: Job;
  onCancel: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) {
      setError("A cancellation reason is required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await cancelJob(job.id, reason.trim());
      onCancelled();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogFrame onClose={onCancel} title={`Cancel ${job.orderReference}`} width="max-w-lg">
      <form className="space-y-4 p-5" onSubmit={submit}>
        <p className="text-sm leading-6 text-muted">This will cancel the job and release any reserved rider capacity. This action cannot be undone.</p>
        <label className="block text-sm font-medium text-ink">
          Cancellation reason <span className="text-rose-700">*</span>
          <textarea className="input mt-1.5 min-h-28 resize-y py-2.5" maxLength={500} onChange={(event) => setReason(event.target.value)} required value={reason} />
          <span className="mt-1 block text-xs font-normal text-muted">{reason.length}/500 characters</span>
        </label>
        {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <button className="button-secondary" disabled={submitting} onClick={onCancel} type="button">Keep job</button>
          <button className="button-primary bg-rose-700 hover:bg-rose-800" disabled={submitting || !reason.trim()} type="submit">
            {submitting && <LoaderCircle className="animate-spin" size={16} />}
            {submitting ? "Cancelling…" : "Cancel job"}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

function JobDetailsDialog({
  bundle,
  loading,
  error,
  onRetry,
  onClose,
  onEditJob,
  onCancelJob,
  onAssigned,
  onLifecycleChanged,
}: {
  bundle: JobDetailBundle | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
  onEditJob: (job: Job) => void;
  onCancelJob: (job: Job) => void;
  onAssigned: () => void;
  onLifecycleChanged: (message: string) => void;
}) {
  const [recommendations, setRecommendations] = useState<JobRecommendations | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");
  const [assigningRiderId, setAssigningRiderId] = useState("");
  const [assignmentError, setAssignmentError] = useState("");
  const [lifecycleAction, setLifecycleAction] = useState("");
  const [lifecycleError, setLifecycleError] = useState("");
  const [rejectingAssignment, setRejectingAssignment] = useState<JobAssignment | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const lifecycleLock = useRef(false);
  const job = bundle?.job;
  const pendingAssignment = bundle?.assignments.find(
    (assignment) =>
      assignment.status === "PENDING" && assignment.capacityReserved,
  );
  const acceptedAssignment = bundle?.assignments.find(
    (assignment) =>
      assignment.status === "ACCEPTED" && assignment.capacityReserved,
  );

  useEffect(() => {
    setLifecycleError("");
    setRejectingAssignment(null);
    setRejectionReason("");
  }, [job?.id]);

  async function runLifecycleAction(
    action: "accept" | "pickup" | "deliver",
    assignmentId?: string,
  ) {
    if (!job || lifecycleLock.current) return;
    lifecycleLock.current = true;
    setLifecycleAction(action);
    setLifecycleError("");
    try {
      if (action === "accept" && assignmentId) {
        await acceptAssignment(assignmentId);
        onLifecycleChanged("Rider accepted the assignment.");
      } else if (action === "pickup") {
        await pickUpJob(job.id);
        onLifecycleChanged("Job marked as picked up.");
      } else if (action === "deliver") {
        await deliverJob(job.id);
        onLifecycleChanged("Job marked as delivered.");
      }
    } catch (requestError) {
      setLifecycleError(getErrorMessage(requestError));
    } finally {
      setLifecycleAction("");
      lifecycleLock.current = false;
    }
  }

  async function submitRejection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectingAssignment || !rejectionReason.trim() || lifecycleLock.current) {
      return;
    }
    lifecycleLock.current = true;
    setLifecycleAction("reject");
    setLifecycleError("");
    try {
      await rejectAssignment(rejectingAssignment.id, rejectionReason.trim());
      setRejectingAssignment(null);
      setRejectionReason("");
      onLifecycleChanged("Rider rejected the assignment.");
    } catch (requestError) {
      setLifecycleError(getErrorMessage(requestError));
    } finally {
      setLifecycleAction("");
      lifecycleLock.current = false;
    }
  }

  async function loadRecommendations() {
    if (!job) return;
    setRecommendationLoading(true);
    setRecommendationError("");
    try {
      setRecommendations(await fetchRecommendations(job.id));
    } catch (requestError) {
      setRecommendationError(getErrorMessage(requestError));
    } finally {
      setRecommendationLoading(false);
    }
  }

  async function assignRider(riderId: string) {
    if (!job) return;
    setAssigningRiderId(riderId);
    setAssignmentError("");
    try {
      await createAssignment(job.id, riderId);
      setRecommendations(null);
      onAssigned();
    } catch (requestError) {
      setAssignmentError(getErrorMessage(requestError));
    } finally {
      setAssigningRiderId("");
    }
  }

  return (
    <DialogFrame onClose={onClose} title={job ? `Job details · ${job.orderReference}` : "Job details"} width="max-w-5xl">
      {loading && !bundle ? (
        <div className="space-y-3 p-5">
          <LoadingSkeleton className="h-24" />
          <LoadingSkeleton className="h-56" />
        </div>
      ) : error && !bundle ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : job && bundle ? (
        <div className="space-y-6 p-5">
          {error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{error} Showing the last loaded details.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <StatusBadge value={job.status} />
              <span className="text-sm text-muted">Created {formatDate(job.createdAt)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {editableStatuses.includes(job.status) && (
                <button className="button-secondary" onClick={() => onEditJob(job)} type="button"><Pencil size={16} /> Edit job</button>
              )}
              {assignableStatuses.includes(job.status) && (
                <button className="button-primary" disabled={recommendationLoading} onClick={loadRecommendations} type="button">
                  {recommendationLoading ? <LoaderCircle className="animate-spin" size={16} /> : <UserRound size={16} />}
                  Find rider &amp; assign
                </button>
              )}
              {cancellableStatuses.includes(job.status) && (
                <button className="button-secondary border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => onCancelJob(job)} type="button"><X size={16} /> Cancel job</button>
              )}
            </div>
          </div>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink">Job information</h3>
            <dl className="grid gap-x-6 gap-y-4 rounded-lg border border-line p-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label="Order reference" value={job.orderReference} />
              <DetailField label="Pickup zone" value={job.pickupZone.name} />
              <DetailField label="Delivery zone" value={job.deliveryZone.name} />
              <DetailField label="Priority" value={<StatusBadge value={job.priority} />} />
              <DetailField label="Required capacity" value={job.requiredCapacity.toLocaleString()} />
              <DetailField label="Deadline" value={formatDate(job.deadline)} />
              <DetailField label="Job ID" value={job.id} />
              <DetailField label="Last updated" value={formatDate(job.updatedAt)} />
            </dl>
          </section>

          {(pendingAssignment || acceptedAssignment) && (
            <section className="rounded-lg border border-line p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink">Assignment and delivery actions</h3>
              {pendingAssignment && job.status === "AWAITING_CONFIRMATION" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted">
                    Awaiting a response from {pendingAssignment.riderDetails.name}.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="button-primary"
                      disabled={Boolean(lifecycleAction)}
                      onClick={() => { void runLifecycleAction("accept", pendingAssignment.id); }}
                      type="button"
                    >
                      {lifecycleAction === "accept" && <LoaderCircle className="animate-spin" size={16} />}
                      {lifecycleAction === "accept" ? "Accepting…" : "Accept assignment"}
                    </button>
                    <button
                      className="button-secondary border-rose-200 text-rose-700 hover:bg-rose-50"
                      disabled={Boolean(lifecycleAction)}
                      onClick={() => {
                        setLifecycleError("");
                        setRejectingAssignment(pendingAssignment);
                        setRejectionReason("");
                      }}
                      type="button"
                    >
                      Reject assignment
                    </button>
                  </div>
                </div>
              )}
              {acceptedAssignment && job.status === "ACCEPTED" && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted">
                    Accepted by {acceptedAssignment.riderDetails.name}; ready for pickup.
                  </p>
                  <button
                    className="button-primary"
                    disabled={Boolean(lifecycleAction)}
                    onClick={() => { void runLifecycleAction("pickup"); }}
                    type="button"
                  >
                    {lifecycleAction === "pickup" && <LoaderCircle className="animate-spin" size={16} />}
                    {lifecycleAction === "pickup" ? "Updating…" : "Mark picked up"}
                  </button>
                </div>
              )}
              {acceptedAssignment && job.status === "PICKED_UP" && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted">
                    Job is with {acceptedAssignment.riderDetails.name}.
                  </p>
                  <button
                    className="button-primary"
                    disabled={Boolean(lifecycleAction)}
                    onClick={() => { void runLifecycleAction("deliver"); }}
                    type="button"
                  >
                    {lifecycleAction === "deliver" && <LoaderCircle className="animate-spin" size={16} />}
                    {lifecycleAction === "deliver" ? "Updating…" : "Mark delivered"}
                  </button>
                </div>
              )}
              {rejectingAssignment && rejectingAssignment.id === pendingAssignment?.id && (
                <form className="mt-4 space-y-3 border-t border-line pt-4" onSubmit={(event) => { void submitRejection(event); }}>
                  <label className="block text-sm font-medium text-ink">
                    Rejection reason
                    <textarea
                      autoFocus
                      className="input mt-1.5 min-h-24 resize-y py-2.5"
                      maxLength={500}
                      onChange={(event) => setRejectionReason(event.target.value)}
                      required
                      value={rejectionReason}
                    />
                  </label>
                  <div className="flex justify-end gap-2">
                    <button
                      className="button-secondary"
                      disabled={Boolean(lifecycleAction)}
                      onClick={() => setRejectingAssignment(null)}
                      type="button"
                    >
                      Keep assignment
                    </button>
                    <button
                      className="button-primary bg-rose-700 hover:bg-rose-800"
                      disabled={Boolean(lifecycleAction) || !rejectionReason.trim()}
                      type="submit"
                    >
                      {lifecycleAction === "reject" && <LoaderCircle className="animate-spin" size={16} />}
                      {lifecycleAction === "reject" ? "Rejecting…" : "Confirm rejection"}
                    </button>
                  </div>
                </form>
              )}
              {lifecycleError && (
                <p className="mt-3 text-sm text-rose-700" role="alert">{lifecycleError}</p>
              )}
            </section>
          )}

          {recommendationError && <p className="text-sm text-rose-700" role="alert">{recommendationError}</p>}
          {recommendations && (
            <section className="rounded-lg border border-brand/20 bg-emerald-50/40 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-ink">Recommended riders</h3>
                  <p className="mt-1 text-xs text-muted">Recommendations are ranked by fit and current workload.</p>
                </div>
                <button aria-label="Close recommendations" className="icon-button" onClick={() => setRecommendations(null)} type="button"><X size={16} /></button>
              </div>
              {recommendations.recommendations.length === 0 ? (
                <p className="text-sm text-muted">No eligible riders are currently available.</p>
              ) : (
                <div className="space-y-2">
                  {recommendations.recommendations.map((recommendation) => (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-3" key={recommendation.riderId}>
                      <div>
                        <p className="text-sm font-semibold text-ink">{recommendation.riderName} <span className="font-normal text-muted">· Score {recommendation.score}</span></p>
                        <p className="mt-1 text-xs text-muted">
                          {recommendation.remainingCapacity} available capacity · {recommendation.workload} active jobs · ~{recommendation.estimatedTravelTime} min travel
                        </p>
                        <p className="mt-1 text-xs text-muted">{recommendation.reasons.join(" · ")}</p>
                      </div>
                      <button className="button-secondary" disabled={Boolean(assigningRiderId)} onClick={() => assignRider(recommendation.riderId)} type="button">
                        {assigningRiderId === recommendation.riderId && <LoaderCircle className="animate-spin" size={15} />}
                        Assign
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {assignmentError && <p className="mt-3 text-sm text-rose-700" role="alert">{assignmentError}</p>}
            </section>
          )}

          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink">Assignment history</h3>
            {bundle.assignments.length === 0 ? (
              <EmptyState title="No assignment history" description="Rider assignments for this job will appear here." />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-line bg-slate-50 text-xs uppercase tracking-wide text-muted">
                    <tr><th className="px-4 py-3">Rider</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Assigned</th><th className="px-4 py-3">Confirmation deadline</th><th className="px-4 py-3">Capacity reserved</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {bundle.assignments.map((assignment) => (
                      <tr key={assignment.id}>
                        <td className="px-4 py-3">
                          <span className="block font-medium text-ink">{assignment.riderDetails.name}</span>
                          <span className="text-xs text-muted">{assignment.riderDetails.phone}</span>
                        </td>
                        <td className="px-4 py-3"><StatusBadge value={assignment.status} /></td>
                        <td className="px-4 py-3">{formatDate(assignment.assignedAt)}</td>
                        <td className="px-4 py-3">{formatDate(assignment.confirmationDeadline)}</td>
                        <td className="px-4 py-3">{assignment.capacityReserved ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink">Job timeline</h3>
            {bundle.timeline.events.length === 0 ? (
              <EmptyState title="No timeline events" description="Lifecycle events will appear here." />
            ) : (
              <ol className="space-y-0 border-l border-line pl-5">
                {bundle.timeline.events.map((event) => (
                  <li className="relative pb-5 last:pb-0" key={event.id}>
                    <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-brand bg-white" />
                    <p className="text-sm font-medium text-ink">{event.description}</p>
                    <p className="mt-1 text-xs text-muted">{formatDate(event.createdAt)} · {event.actor} · {formatLabel(event.eventType)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink">Audit events</h3>
            {bundle.auditEvents.length === 0 ? (
              <EmptyState title="No audit events" description="Audit activity will appear here." />
            ) : (
              <div className="space-y-2">
                {bundle.auditEvents.map((event) => (
                  <article className="rounded-lg border border-line p-3" key={event.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">{formatLabel(event.eventType)}</p>
                      <span className="text-xs text-muted">{formatDate(event.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{event.description}</p>
                    <p className="mt-1 text-xs text-muted">Actor: {event.actor} · Entity: {event.entityType}</p>
                    {event.details !== null && event.details !== undefined && (
                      <details className="mt-2 text-xs text-muted">
                        <summary className="cursor-pointer font-medium">Event details</summary>
                        <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(event.details, null, 2)}</pre>
                      </details>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </DialogFrame>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}
