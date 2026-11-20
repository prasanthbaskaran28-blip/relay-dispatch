import apiClient from "./apiClient";
import { fetchZonePerformance } from "./dashboardService";
import type {
  ApiData,
  AuditEvent,
  Job,
  JobAssignment,
  JobAuditEvent,
  JobEvent,
  JobPriority,
  JobRecommendations,
  JobStatus,
  ManualQueueJob,
  ManualQueueJobDetails,
  JobTimeline,
  PaginatedResponse,
  Rider,
} from "../types/api";

export interface JobQuery {
  q?: string;
  status?: JobStatus;
  priority?: JobPriority;
  pickupZoneId?: string;
  deliveryZoneId?: string;
  page: number;
  pageSize: number;
}

export interface ManualQueueQuery {
  q?: string;
  priority?: JobPriority;
  pickupZoneId?: string;
  deliveryZoneId?: string;
  page: number;
  pageSize: number;
}

export interface AuditLogQuery {
  q?: string;
  eventType?: string;
  entityType?: "JOB" | "ASSIGNMENT";
  actor?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export interface ZoneOption {
  id: string;
  name: string;
}

export interface CreateJobInput {
  orderReference: string;
  pickupZoneId: string;
  deliveryZoneId: string;
  requiredCapacity: number;
  priority: JobPriority;
  deadline: string | null;
  idempotencyKey: string;
}

export interface UpdateJobInput {
  pickupZoneId: string;
  deliveryZoneId: string;
  requiredCapacity: number;
  priority: JobPriority;
  deadline: string | null;
}

export interface ReassignmentInput {
  assignmentId: string;
  riderId: string;
  reassignmentReason?: string;
  overrideReason?: string;
}

export async function fetchJobs(query: JobQuery) {
  const { data } = await apiClient.get<PaginatedResponse<Job>>("/jobs", {
    params: query,
  });
  return data;
}

export async function fetchManualQueue(query: ManualQueueQuery) {
  const { data } = await apiClient.get<PaginatedResponse<ManualQueueJob>>(
    "/manual-queue",
    { params: query },
  );
  return data;
}

export async function fetchManualQueueJob(id: string) {
  const { data } = await apiClient.get<ApiData<ManualQueueJobDetails>>(
    `/manual-queue/${id}`,
  );
  return data.data;
}

export async function retryManualQueueJob(
  id: string,
  idempotencyKey: string = crypto.randomUUID(),
) {
  const { data } = await apiClient.post<ApiData<JobRecommendations>>(
    `/manual-queue/${id}/retry`,
    {},
    { headers: { "Idempotency-Key": idempotencyKey } },
  );
  return data.data;
}

export async function dismissManualQueueJob(id: string, reason: string) {
  await apiClient.post<ApiData<Job>>(`/manual-queue/${id}/dismiss`, { reason });
}

export async function fetchAssignmentJobs() {
  const statuses: JobStatus[] = [
    "NEW",
    "READY_FOR_ASSIGNMENT",
    "MANUAL_QUEUE",
    "AWAITING_CONFIRMATION",
    "ACCEPTED",
  ];
  const pageSize = 100;
  const pages = await Promise.all(statuses.map(async (status) => {
    const firstPage = await fetchJobs({ status, page: 1, pageSize });
    const remainingPages = await Promise.all(
      Array.from(
        { length: Math.max(0, firstPage.pagination.totalPages - 1) },
        (_, index) => fetchJobs({ status, page: index + 2, pageSize }),
      ),
    );
    return [
      ...firstPage.data,
      ...remainingPages.flatMap((result) => result.data),
    ];
  }));
  return pages.flat().sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export async function fetchZones() {
  const performance = await fetchZonePerformance();
  return performance.map((zone) => ({
    id: zone.zoneId,
    name: zone.zoneName,
  })) satisfies ZoneOption[];
}

export async function createJob(input: CreateJobInput) {
  const { data } = await apiClient.post<ApiData<Job>>("/jobs", input);
  return data.data;
}

export async function updateJob(id: string, input: UpdateJobInput) {
  const { data } = await apiClient.patch<ApiData<Job>>(`/jobs/${id}`, input);
  return data.data;
}

export async function cancelJob(id: string, reason: string) {
  const { data } = await apiClient.post<ApiData<Job>>(`/jobs/${id}/cancel`, {
    reason,
  });
  return data.data;
}

export async function fetchJob(id: string) {
  const { data } = await apiClient.get<ApiData<Job & { events: JobEvent[] }>>(
    `/jobs/${id}`,
  );
  return data.data;
}

export async function fetchJobAssignments(id: string) {
  const { data } = await apiClient.get<ApiData<JobAssignment[]>>(
    `/jobs/${id}/assignments`,
  );
  return data.data;
}

export async function fetchJobTimeline(id: string) {
  const { data } = await apiClient.get<ApiData<JobTimeline>>(
    `/jobs/${id}/timeline`,
  );
  return data.data;
}

export async function fetchJobAuditEvents(id: string) {
  const { data } = await apiClient.get<ApiData<JobAuditEvent[]>>(
    `/jobs/${id}/audit-logs`,
  );
  return data.data;
}

export async function fetchAuditLogs(query: AuditLogQuery) {
  const { data } = await apiClient.get<PaginatedResponse<AuditEvent>>(
    "/audit-logs",
    { params: query },
  );
  return data;
}

export async function fetchAuditLog(id: string) {
  const { data } = await apiClient.get<ApiData<AuditEvent>>(`/audit-logs/${id}`);
  return data.data;
}

export async function fetchRider(id: string) {
  const { data } = await apiClient.get<ApiData<Rider>>(`/riders/${id}`);
  return data.data;
}

export async function fetchRecommendations(id: string) {
  const { data } = await apiClient.get<ApiData<JobRecommendations>>(
    `/jobs/${id}/recommendations`,
  );
  return data.data;
}

export async function createAssignment(
  jobId: string,
  riderId: string,
  overrideReason?: string,
  idempotencyKey: string = crypto.randomUUID(),
) {
  const { data } = await apiClient.post<ApiData<JobAssignment>>(
    `/jobs/${jobId}/assignments`,
    { riderId, ...(overrideReason ? { overrideReason } : {}) },
    { headers: { "Idempotency-Key": idempotencyKey } },
  );
  return data.data;
}

export async function acceptAssignment(assignmentId: string) {
  const { data } = await apiClient.post<ApiData<JobAssignment>>(
    `/assignments/${assignmentId}/accept`,
  );
  return data.data;
}

export async function rejectAssignment(
  assignmentId: string,
  rejectionReason: string,
) {
  const { data } = await apiClient.post<ApiData<JobAssignment>>(
    `/assignments/${assignmentId}/reject`,
    { rejectionReason },
  );
  return data.data;
}

export async function pickUpJob(jobId: string) {
  const { data } = await apiClient.post<ApiData<Job>>(`/jobs/${jobId}/pickup`);
  return data.data;
}

export async function deliverJob(jobId: string) {
  const { data } = await apiClient.post<ApiData<Job>>(`/jobs/${jobId}/deliver`);
  return data.data;
}

export async function reassignJob(
  jobId: string,
  input: ReassignmentInput,
  idempotencyKey: string = crypto.randomUUID(),
) {
  const { data } = await apiClient.post<ApiData<JobAssignment>>(
    `/jobs/${jobId}/reassignments`,
    input,
    { headers: { "Idempotency-Key": idempotencyKey } },
  );
  return data.data;
}
