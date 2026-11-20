import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useToast } from "../components/ui/Toast";
import DataTable, { type Column } from "../components/ui/DataTable";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import LoadingSkeleton from "../components/ui/LoadingSkeleton";
import SearchFilter from "../components/ui/SearchFilter";
import StatusBadge from "../components/ui/StatusBadge";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { getApiError } from "../services/apiClient";
import {
  createAssignment,
  fetchAssignmentJobs,
  fetchJob,
  fetchJobAssignments,
  fetchRecommendations,
  reassignJob,
} from "../services/jobsService";
import { fetchRider, fetchRiders } from "../services/ridersService";
import type {
  AssignmentStatus,
  Job,
  JobAssignment,
  JobPriority,
  JobRecommendation,
  JobRecommendations,
  JobStatus,
  Rider,
} from "../types/api";

type AssignmentMode = "assign" | "reassign";

interface RankedRider extends JobRecommendation {
  rank: number;
  profile: Rider | null;
}

interface AssignmentDraft {
  mode: AssignmentMode;
  job: Job;
  recommendation: RankedRider;
  activeAssignment?: JobAssignment;
}

interface AssignmentConfirmation extends AssignmentDraft {
  overrideReason?: string;
  reassignmentReason?: string;
  idempotencyKey: string;
}

interface AssignmentResult {
  assignment: JobAssignment;
  jobStatus: JobStatus | null;
  refreshError?: string;
}

const directAssignmentStatuses: JobStatus[] = [
  "NEW",
  "READY_FOR_ASSIGNMENT",
  "MANUAL_QUEUE",
];
const reassignmentStatuses: JobStatus[] = ["AWAITING_CONFIRMATION", "ACCEPTED"];

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

function priorityColor(priority: JobPriority) {
  if (priority === "URGENT") return "bg-rose-500";
  if (priority === "HIGH") return "bg-orange-500";
  if (priority === "NORMAL") return "bg-blue-500";
  return "bg-slate-400";
}

function activeAssignmentForJob(
  job: Job,
  assignments: JobAssignment[],
): JobAssignment | undefined {
  const requiredStatus: AssignmentStatus | undefined =
    job.status === "ACCEPTED"
      ? "ACCEPTED"
      : job.status === "AWAITING_CONFIRMATION"
        ? "PENDING"
        : undefined;
  if (!requiredStatus) return undefined;
  return assignments.find(
    (assignment) =>
      assignment.status === requiredStatus && assignment.capacityReserved,
  );
}

async function fetchRecommendedRiderProfiles(
  recommendations: JobRecommendations,
): Promise<Map<string, Rider>> {
  const riderIds = new Set(
    recommendations.recommendations.map(({ riderId }) => riderId),
  );
  if (riderIds.size === 0) return new Map();

  const pageSize = 100;
  const firstPage = await fetchRiders({
    isAvailable: true,
    page: 1,
    pageSize,
  });
  const riders = [...firstPage.data];
  if (firstPage.pagination.totalPages > 1) {
    const remainingPages = await Promise.all(
      Array.from(
        { length: firstPage.pagination.totalPages - 1 },
        (_, index) =>
          fetchRiders({
            isAvailable: true,
            page: index + 2,
            pageSize,
          }),
      ),
    );
    riders.push(...remainingPages.flatMap((page) => page.data));
  }

  const profiles = new Map(
    riders
      .filter((rider) => riderIds.has(rider.id))
      .map((rider) => [rider.id, rider]),
  );
  const missingIds = [...riderIds].filter((riderId) => !profiles.has(riderId));
  const missingProfiles = await Promise.all(
    missingIds.map(async (riderId) => [riderId, await fetchRider(riderId)] as const),
  );
  for (const [riderId, rider] of missingProfiles) profiles.set(riderId, rider);
  return profiles;
}

export default function AssignmentsPage() {
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedJobId = searchParams.get("jobId");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [jobSearch, setJobSearch] = useState("");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [recommendations, setRecommendations] = useState<JobRecommendations | null>(null);
  const [riderProfiles, setRiderProfiles] = useState<Map<string, Rider>>(
    () => new Map<string, Rider>(),
  );
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [assignmentHistory, setAssignmentHistory] = useState<JobAssignment[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [draft, setDraft] = useState<AssignmentDraft | null>(null);
  const [confirmation, setConfirmation] = useState<AssignmentConfirmation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [result, setResult] = useState<AssignmentResult | null>(null);
  const submissionLock = useRef(false);

  useEffect(() => {
    let active = true;
    setJobsLoading(true);
    setJobsError("");
    fetchAssignmentJobs()
      .then((resultJobs) => {
        if (active) setJobs(resultJobs);
      })
      .catch((error: unknown) => {
        if (active) setJobsError(getApiError(error).message);
      })
      .finally(() => {
        if (active) setJobsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshIndex]);

  useEffect(() => {
    if (!requestedJobId) return;
    const requestedJob = jobs.find((job) => job.id === requestedJobId);
    if (requestedJob && selectedJob?.id !== requestedJob.id) {
      setSelectedJob(requestedJob);
    }
  }, [jobs, requestedJobId, selectedJob?.id]);

  useEffect(() => {
    if (!selectedJob) {
      setRecommendations(null);
      setRiderProfiles(new Map());
      setAssignmentHistory([]);
      setSelectionError("");
      setHistoryError("");
      return;
    }

    let active = true;
    setRecommendations(null);
    setRiderProfiles(new Map());
    setAssignmentHistory([]);
    setSelectionError("");
    setHistoryError("");
    setAssignmentError("");
    setResult(null);
    setSelectionLoading(true);

    Promise.all([
      fetchRecommendations(selectedJob.id),
      fetchJobAssignments(selectedJob.id),
    ])
      .then(async ([recommendationResponse, history]) => {
        if (active) {
          setRecommendations(recommendationResponse);
          setAssignmentHistory(history);
        }
        try {
          const profiles = await fetchRecommendedRiderProfiles(recommendationResponse);
          if (active) setRiderProfiles(profiles);
        } catch (error: unknown) {
          if (active) {
            setSelectionError(
              `Recommendations loaded, but rider details could not be loaded: ${getApiError(error).message}`,
            );
          }
        }
      })
      .catch((error: unknown) => {
        if (active) setSelectionError(getApiError(error).message);
      })
      .finally(() => {
        if (active) setSelectionLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedJob?.id]);

  const visibleJobs = useMemo(() => {
    const query = jobSearch.trim().toLocaleLowerCase();
    if (!query) return jobs;
    return jobs.filter((job) =>
      [
        job.orderReference,
        job.pickupZone.name,
        job.deliveryZone.name,
      ].some((value) => value.toLocaleLowerCase().includes(query)),
    );
  }, [jobs, jobSearch]);

  const jobColumns = useMemo<Column<Job>[]>(() => [
    {
      key: "orderReference",
      header: "Order reference",
      render: (job) => (
        <button
          className={`font-semibold hover:underline ${selectedJob?.id === job.id ? "text-ink" : "text-brand"}`}
          onClick={() => selectJob(job)}
          type="button"
        >
          {job.orderReference}
        </button>
      ),
    },
    {
      key: "route",
      header: "Zones",
      render: (job) => (
        <span className="text-xs leading-5 text-ink">
          {job.pickupZone.name} <span className="text-muted">→</span> {job.deliveryZone.name}
        </span>
      ),
    },
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
      key: "capacity",
      header: "Capacity",
      render: (job) => job.requiredCapacity.toLocaleString(),
    },
    {
      key: "deadline",
      header: "Deadline",
      render: (job) => formatDate(job.deadline),
    },
    {
      key: "status",
      header: "Status",
      render: (job) => <StatusBadge value={job.status} />,
    },
  ], [selectedJob?.id]);

  function selectJob(job: Job) {
    setSelectedJob(job);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("jobId", job.id);
      return next;
    }, { replace: true });
    setDraft(null);
    setConfirmation(null);
    setResult(null);
  }

  function openAssignmentDialog(
    recommendation: RankedRider,
    mode: AssignmentMode,
    activeAssignment?: JobAssignment,
  ) {
    if (!selectedJob || submitting) return;
    setDraft({ mode, job: selectedJob, recommendation, activeAssignment });
    setAssignmentError("");
  }

  function continueToConfirmation(
    values: { overrideReason?: string; reassignmentReason?: string },
  ) {
    if (!draft) return;
    setConfirmation({
      ...draft,
      ...values,
      idempotencyKey: crypto.randomUUID(),
    });
    setDraft(null);
  }

  async function submitAssignment() {
    const action = confirmation;
    if (!action || submissionLock.current) return;
    submissionLock.current = true;
    setSubmitting(true);
    setConfirmation(null);
    setAssignmentError("");

    try {
      const assignment = action.mode === "assign"
        ? await createAssignment(
            action.job.id,
            action.recommendation.riderId,
            action.overrideReason,
            action.idempotencyKey,
          )
        : await reassignJob(
            action.job.id,
            {
              assignmentId: action.activeAssignment!.id,
              riderId: action.recommendation.riderId,
              ...(action.overrideReason ? { overrideReason: action.overrideReason } : {}),
              ...(action.reassignmentReason ? { reassignmentReason: action.reassignmentReason } : {}),
            },
            action.idempotencyKey,
          );

      setResult({ assignment, jobStatus: null });
      notify(
        action.mode === "assign"
          ? `Rider assigned to ${action.job.orderReference}.`
          : `Rider reassigned for ${action.job.orderReference}.`,
      );
      setRefreshIndex((current) => current + 1);
      setAssignmentHistory((current) => [
        assignment,
        ...current.filter(({ id }) => id !== assignment.id),
      ]);

      try {
        const updatedJob = await fetchJob(action.job.id);
        setSelectedJob(updatedJob);
        setResult((current) => current
          ? { ...current, jobStatus: updatedJob.status }
          : current);
      } catch (error: unknown) {
        setResult((current) => current
          ? { ...current, refreshError: getApiError(error).message }
          : current);
      }

      try {
        setAssignmentHistory(await fetchJobAssignments(action.job.id));
        setHistoryError("");
      } catch (error: unknown) {
        setHistoryError(getApiError(error).message);
      }

      setRecommendations(null);
      setRiderProfiles(new Map());
      setSelectionError("");
      setSelectionLoading(true);
      try {
        const refreshedRecommendations = await fetchRecommendations(action.job.id);
        setRecommendations(refreshedRecommendations);
        try {
          setRiderProfiles(
            await fetchRecommendedRiderProfiles(refreshedRecommendations),
          );
        } catch (error: unknown) {
          setSelectionError(
            `Recommendations loaded, but rider details could not be loaded: ${getApiError(error).message}`,
          );
        }
      } catch (error: unknown) {
        setSelectionError(getApiError(error).message);
      } finally {
        setSelectionLoading(false);
      }
    } catch (error: unknown) {
      const message = getApiError(error).message;
      setAssignmentError(message);
      notify(message, "error");
    } finally {
      setSubmitting(false);
      submissionLock.current = false;
    }
  }

  async function retryJobStatusRefresh() {
    if (!selectedJob) return;
    try {
      const updatedJob = await fetchJob(selectedJob.id);
      setSelectedJob(updatedJob);
      setResult((current) => current
        ? { ...current, jobStatus: updatedJob.status, refreshError: undefined }
        : current);
    } catch (error: unknown) {
      setResult((current) => current
        ? { ...current, refreshError: getApiError(error).message }
        : current);
    }
  }

  const canDirectAssign = selectedJob
    ? directAssignmentStatuses.includes(selectedJob.status)
    : false;
  const currentAssignment = selectedJob
    ? activeAssignmentForJob(selectedJob, assignmentHistory)
    : undefined;
  const canReassign = Boolean(
    selectedJob &&
    reassignmentStatuses.includes(selectedJob.status) &&
    currentAssignment,
  );

  return (
    <div className="space-y-5">
      <section className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-title">Dispatch assignment workbench</h2>
            <p className="section-caption">Choose a job to review ranked riders and manage its active assignment.</p>
          </div>
          <button
            className="button-secondary"
            disabled={jobsLoading}
            onClick={() => setRefreshIndex((current) => current + 1)}
            type="button"
          >
            <RefreshCw className={jobsLoading ? "animate-spin" : ""} size={16} />
            Refresh jobs
          </button>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <section className="panel overflow-hidden">
          <div className="space-y-3 border-b border-line p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="section-title">Available jobs</h2>
                <p className="section-caption">{visibleJobs.length} of {jobs.length} jobs</p>
              </div>
            </div>
            <SearchFilter
              onChange={setJobSearch}
              placeholder="Search order or zone"
              value={jobSearch}
            />
          </div>
          {jobsError && jobs.length === 0 ? (
            <ErrorState
              message={jobsError}
              onRetry={() => setRefreshIndex((current) => current + 1)}
            />
          ) : jobsLoading && jobs.length === 0 ? (
            <div aria-label="Loading jobs" className="space-y-3 p-5" role="status">
              {Array.from({ length: 5 }, (_, index) => <LoadingSkeleton className="h-12" key={index} />)}
            </div>
          ) : jobsError ? (
            <p className="px-5 py-3 text-sm text-rose-700">{jobsError} Showing last loaded jobs.</p>
          ) : visibleJobs.length === 0 ? (
            <EmptyState
              title={jobs.length === 0 ? "No jobs are ready for dispatch" : "No matching jobs"}
              description={jobs.length === 0
                ? "Jobs become available here when their lifecycle state allows assignment or reassignment."
                : "Try another order reference or zone."}
            />
          ) : (
            <DataTable columns={jobColumns} rows={visibleJobs} />
          )}
        </section>

        <section className="panel min-h-[420px] overflow-hidden">
          {!selectedJob ? (
            <EmptyState
              title="Select a job"
              description="Choose an assignable or active-assignment job to view recommendations."
            />
          ) : (
            <>
              <div className="border-b border-line p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Selected job</p>
                    <h2 className="mt-1 text-lg font-semibold text-ink">{selectedJob.orderReference}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {selectedJob.pickupZone.name} <span className="text-slate-400">→</span> {selectedJob.deliveryZone.name}
                    </p>
                  </div>
                  <StatusBadge value={selectedJob.status} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <JobSummary label="Priority" value={<StatusBadge value={selectedJob.priority} />} />
                  <JobSummary label="Required capacity" value={selectedJob.requiredCapacity.toLocaleString()} />
                  <JobSummary label="Deadline" value={formatDate(selectedJob.deadline)} />
                </div>
                {canReassign && currentAssignment && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <div className="text-sm text-amber-900">
                      Active rider: <span className="font-semibold">{currentAssignment.rider.name}</span>
                      <span className="ml-1 text-xs">· {formatLabel(currentAssignment.status)}</span>
                    </div>
                    <span className="text-xs font-medium text-amber-800">Reassignment available</span>
                  </div>
                )}
              </div>

              <div className="space-y-5 p-4 sm:p-5">
                {result && (
                  <AssignmentResultCard
                    onRetry={retryJobStatusRefresh}
                    result={result}
                  />
                )}
                {selectionError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800" role="alert">
                    {selectionError}
                  </div>
                )}
                {assignmentError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800" role="alert">
                    {assignmentError}
                  </div>
                )}
                {historyError && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800" role="alert">
                    Assignment succeeded, but history could not be refreshed: {historyError}
                  </div>
                )}

                <section>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 className="section-title">Ranked rider recommendations</h3>
                      <p className="section-caption">Eligibility, score, workload and zone coverage for this job.</p>
                    </div>
                    {selectionLoading && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                        <LoaderCircle className="animate-spin" size={14} /> Loading recommendations
                      </span>
                    )}
                  </div>
                  {selectionLoading ? (
                    <div className="space-y-3">
                      <LoadingSkeleton className="h-32" />
                      <LoadingSkeleton className="h-32" />
                    </div>
                  ) : !recommendations ? (
                    <EmptyState title="Recommendations unavailable" description={selectionError || "Try refreshing the selected job."} />
                  ) : recommendations.recommendations.length === 0 ? (
                    <EmptyState title="No eligible riders" description="No riders currently meet the eligibility requirements for this job." />
                  ) : (
                    <div className="space-y-3">
                      {recommendations.recommendations.map((recommendation, index) => {
                        const rankedRider: RankedRider = {
                          ...recommendation,
                          rank: index + 1,
                          profile: riderProfiles.get(recommendation.riderId) ?? null,
                        };
                        const mode: AssignmentMode | null = canDirectAssign
                          ? "assign"
                          : canReassign
                            ? "reassign"
                            : null;
                        const alreadyAssigned = recommendation.riderId === currentAssignment?.riderId;
                        const disabled = !mode || !rankedRider.profile?.isAvailable || alreadyAssigned || submitting;
                        return (
                          <RecommendationCard
                            key={recommendation.riderId}
                            onChoose={() => {
                              if (mode) openAssignmentDialog(rankedRider, mode, currentAssignment);
                            }}
                            recommendation={rankedRider}
                            actionLabel={mode === "reassign" ? "Reassign" : mode === "assign" ? "Assign" : undefined}
                            disabled={disabled}
                            submitting={submitting}
                          />
                        );
                      })}
                    </div>
                  )}
                  {recommendations?.excludedRiders.length ? (
                    <details className="mt-4 rounded-lg border border-line px-4 py-3">
                      <summary className="cursor-pointer text-sm font-medium text-ink">
                        Eligibility details · {recommendations.excludedRiders.length} excluded riders
                      </summary>
                      <ul className="mt-3 space-y-2">
                        {recommendations.excludedRiders.map((rider) => (
                          <li className="flex flex-wrap justify-between gap-2 text-xs" key={rider.riderId}>
                            <span className="font-medium text-ink">{rider.riderName}</span>
                            <span className="text-muted">{rider.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </section>

                <AssignmentHistory
                  assignments={assignmentHistory}
                  error={historyError}
                  loading={selectionLoading}
                  onRetry={() => {
                    if (!selectedJob) return;
                    setHistoryError("");
                    fetchJobAssignments(selectedJob.id)
                      .then(setAssignmentHistory)
                      .catch((error: unknown) => setHistoryError(getApiError(error).message));
                  }}
                  title="Assignment history"
                />
              </div>
            </>
          )}
        </section>
      </div>

      {draft && (
        <AssignmentReasonDialog
          draft={draft}
          onCancel={() => setDraft(null)}
          onContinue={continueToConfirmation}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          confirmLabel={confirmation.mode === "assign" ? "Confirm assignment" : "Confirm reassignment"}
          description={confirmation.mode === "assign"
            ? `Assign ${confirmation.recommendation.riderName} to ${confirmation.job.orderReference}?`
            : `Replace the current rider with ${confirmation.recommendation.riderName} on ${confirmation.job.orderReference}? The previous assignment will remain in the job history.`}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => { void submitAssignment(); }}
          open
          title={confirmation.mode === "assign" ? "Confirm assignment" : "Confirm reassignment"}
        />
      )}
    </div>
  );

}

function RecommendationCard({
  recommendation,
  actionLabel,
  disabled,
  submitting,
  onChoose,
}: {
  recommendation: RankedRider;
  actionLabel?: string;
  disabled: boolean;
  submitting: boolean;
  onChoose: () => void;
}) {
  const score = Math.max(0, Math.min(100, recommendation.score));
  const reserved = recommendation.profile?.reservedCapacity ?? recommendation.reservedCapacity;
  const maxCapacity = recommendation.profile?.maxCapacity ?? recommendation.maxCapacity;
  const utilization = maxCapacity > 0
    ? Math.max(0, Math.min(100, Math.round((reserved / maxCapacity) * 100)))
    : 0;
  const profileZones = recommendation.profile?.zones.map(({ zone }) => zone.name) ?? [];
  const isTop = recommendation.rank === 1;

  return (
    <article className={`rounded-xl border p-4 transition-shadow ${isTop ? "border-brand bg-emerald-50/40 shadow-sm" : "border-line bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${isTop ? "bg-brand text-white" : "bg-slate-100 text-slate-700"}`}>
            #{recommendation.rank}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-ink">{recommendation.riderName}</h4>
              {isTop && <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Top recommendation</span>}
              {recommendation.profile ? (
                <StatusBadge value={recommendation.profile.isAvailable ? "AVAILABLE" : "UNAVAILABLE"} />
              ) : (
                <StatusBadge value="UNKNOWN" />
              )}
            </div>
            <p className="mt-1 text-xs text-muted">{recommendation.workload} active assignment{recommendation.workload === 1 ? "" : "s"} · ~{recommendation.estimatedTravelTime} min estimated travel</p>
          </div>
        </div>
        <div className="min-w-[136px]">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-muted">Recommendation score</span>
            <span className="font-bold text-ink">{recommendation.score}</span>
          </div>
          <div aria-label={`Recommendation score ${score} out of 100`} className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${isTop ? "bg-brand" : "bg-blue-500"}`} style={{ width: `${score}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Supported zones</p>
          {profileZones.length ? (
            <div className="flex flex-wrap gap-1.5">
              {profileZones.map((zone) => <span className="rounded-md bg-white px-2 py-1 text-xs text-ink" key={zone}>{zone}</span>)}
            </div>
          ) : (
            <p className="text-xs text-muted">{recommendation.profile ? "No configured zones" : "Rider profile unavailable"}</p>
          )}
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wide text-muted">Capacity remaining</span>
            <span className="font-medium text-ink">{recommendation.remainingCapacity} / {maxCapacity}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${utilization >= 90 ? "bg-amber-500" : "bg-brand"}`} style={{ width: `${utilization}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted">{reserved} reserved · {recommendation.remainingCapacity} available for this job</p>
        </div>
      </div>

      <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {recommendation.reasons.map((reason) => (
          <li className="flex items-start gap-1.5 text-xs text-muted" key={reason}>
            <CheckCircle2 className="mt-0.5 shrink-0 text-brand" size={13} />
            <span>{reason}</span>
          </li>
        ))}
      </ul>

      {actionLabel && (
        <div className="mt-4 flex justify-end">
          <button className={isTop ? "button-primary" : "button-secondary"} disabled={disabled} onClick={onChoose} type="button">
            {submitting && <LoaderCircle className="animate-spin" size={15} />}
            {recommendation.rank > 1 && <AlertCircle size={14} />}
            {actionLabel}
          </button>
        </div>
      )}
    </article>
  );
}

function AssignmentReasonDialog({
  draft,
  onCancel,
  onContinue,
}: {
  draft: AssignmentDraft;
  onCancel: () => void;
  onContinue: (values: { overrideReason?: string; reassignmentReason?: string }) => void;
}) {
  const needsOverrideReason = draft.recommendation.rank > 1;
  const needsReassignmentReason =
    draft.mode === "reassign" &&
    draft.activeAssignment?.status === "ACCEPTED";
  const [overrideReason, setOverrideReason] = useState("");
  const [reassignmentReason, setReassignmentReason] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (needsOverrideReason && !overrideReason.trim()) {
      setError("Provide a reason for selecting a rider below rank 1.");
      return;
    }
    if (needsReassignmentReason && !reassignmentReason.trim()) {
      setError("Provide a reassignment reason when replacing an accepted assignment.");
      return;
    }
    onContinue({
      ...(needsOverrideReason ? { overrideReason: overrideReason.trim() } : {}),
      ...(needsReassignmentReason ? { reassignmentReason: reassignmentReason.trim() } : {}),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onCancel}>
      <section
        aria-labelledby="assignment-reason-title"
        aria-modal="true"
        className="w-full max-w-xl rounded-xl bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-ink" id="assignment-reason-title">
            {draft.mode === "assign" ? "Assign rider" : "Reassign rider"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {draft.job.orderReference} · #{draft.recommendation.rank} {draft.recommendation.riderName}
          </p>
        </div>
        <form className="space-y-4 p-5" onSubmit={submit}>
          {needsOverrideReason ? (
            <label className="block text-sm font-medium text-ink">
              Override reason <span className="text-rose-700">*</span>
              <textarea
                autoFocus
                className="input mt-1.5 min-h-24 resize-y py-2.5"
                maxLength={500}
                onChange={(event) => setOverrideReason(event.target.value)}
                required
                value={overrideReason}
              />
              <span className="mt-1 block text-xs font-normal text-muted">{overrideReason.length}/500 · required below rank 1</span>
            </label>
          ) : (
            <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
              Rank 1 is the top recommendation; no override reason is required.
            </p>
          )}
          {needsReassignmentReason && (
            <label className="block text-sm font-medium text-ink">
              Reassignment reason <span className="text-rose-700">*</span>
              <textarea
                className="input mt-1.5 min-h-24 resize-y py-2.5"
                maxLength={500}
                onChange={(event) => setReassignmentReason(event.target.value)}
                required
                value={reassignmentReason}
              />
              <span className="mt-1 block text-xs font-normal text-muted">{reassignmentReason.length}/500 · required for accepted assignments</span>
            </label>
          )}
          {draft.mode === "reassign" && !needsReassignmentReason && (
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-muted">
              The current assignment is pending. A reassignment reason is optional.
            </p>
          )}
          {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <button className="button-secondary" onClick={onCancel} type="button">Cancel</button>
            <button className="button-primary" type="submit">
              <ArrowRightLeft size={16} /> Review and confirm
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AssignmentResultCard({
  result,
  onRetry,
}: {
  result: AssignmentResult;
  onRetry: () => void;
}) {
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-emerald-100 p-2 text-emerald-700"><CheckCircle2 size={18} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-emerald-900">Assignment created</h3>
          <p className="mt-1 text-sm text-emerald-900">
            {result.assignment.rider.name} · <StatusBadge value={result.assignment.status} />
          </p>
          <div className="mt-3 grid gap-2 text-xs text-emerald-900 sm:grid-cols-2">
            <p className="inline-flex items-center gap-1.5"><Clock3 size={14} /> Confirmation deadline: {formatDate(result.assignment.confirmationDeadline)}</p>
            <p>Job status: {result.jobStatus ? <StatusBadge value={result.jobStatus} /> : "Refreshing…"}</p>
          </div>
          {result.refreshError && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-amber-900">
              <span>Assignment succeeded, but job status could not be refreshed: {result.refreshError}</span>
              <button className="font-semibold underline" onClick={onRetry} type="button">Retry</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AssignmentHistory({
  assignments,
  loading,
  error,
  onRetry,
  title,
}: {
  assignments: JobAssignment[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  title: string;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="section-title">{title}</h3>
        {error && <button className="text-xs font-semibold text-brand hover:underline" onClick={onRetry} type="button">Retry</button>}
      </div>
      {loading && assignments.length === 0 ? (
        <LoadingSkeleton className="h-24" />
      ) : assignments.length === 0 ? (
        <EmptyState title="No assignment history" description="Assignments and reassignments for this job will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-line bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-3">Rider</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Assigned</th><th className="px-4 py-3">Confirmation deadline</th><th className="px-4 py-3">Reason</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink">{assignment.rider.name}</span>
                    {assignment.reassignedFromId && <span className="ml-1 text-[10px] text-muted">Reassigned</span>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge value={assignment.status} /></td>
                  <td className="px-4 py-3">{formatDate(assignment.assignedAt)}</td>
                  <td className="px-4 py-3">{formatDate(assignment.confirmationDeadline)}</td>
                  <td className="max-w-48 truncate px-4 py-3 text-xs text-muted" title={assignment.reassignmentReason ?? assignment.overrideReason ?? ""}>
                    {assignment.reassignmentReason ?? assignment.overrideReason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function JobSummary({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 text-sm font-medium text-ink">{value}</div>
    </div>
  );
}
