export interface ApiErrorResponse {
  error?: {
    code?: string;
    message?: string;
    details?: Array<{ field: string; message: string }>;
  };
}

export interface ApiData<T> {
  data: T;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export type JobStatus =
  | "NEW"
  | "READY_FOR_ASSIGNMENT"
  | "AWAITING_CONFIRMATION"
  | "ACCEPTED"
  | "PICKED_UP"
  | "DELIVERED"
  | "MANUAL_QUEUE"
  | "CANCELLED";

export type JobPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type AssignmentStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "COMPLETED"
  | "REASSIGNED"
  | "CANCELLED";

export interface DashboardOverview {
  jobs: {
    total: number;
    awaitingConfirmation: number;
    accepted: number;
    pickedUp: number;
    delivered: number;
    manualQueue: number;
    cancelled: number;
    deliveryCompletionRate: number;
  };
  riders: {
    total: number;
    available: number;
    unavailable: number;
    withActiveAssignments: number;
  };
  assignments: {
    pending: number;
    accepted: number;
    rejected: number;
    expired: number;
    reassignmentCount: number;
  };
  operationalPerformance: {
    deliveryCompletionRate: number;
    averageAssignmentConfirmationTimeMs: number | null;
    averageDeliveryTimeMs: number | null;
    jobsApproachingDeadline: number;
    overdueActiveJobs: number;
    deadlineWarningWindowMinutes: number;
  };
  recentActivity: Array<{
    id: string;
    eventType: string;
    jobId: string;
    orderReference: string;
    actor: string;
    timestamp: string;
  }>;
}

export interface DashboardTrends {
  from: string;
  to: string;
  days: Array<{
    date: string;
    createdJobs: number;
    deliveredJobs: number;
    cancelledJobs: number;
    pendingJobs: number;
  }>;
}

export interface ZonePerformance {
  zoneId: string;
  zoneName: string;
  jobVolume: number;
  deliveredJobs: number;
  pendingJobs: number;
  deliveryCompletionRate: number;
}

export interface Job {
  id: string;
  orderReference: string;
  pickupZoneId: string;
  deliveryZoneId: string;
  requiredCapacity: number;
  priority: JobPriority;
  status: JobStatus;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  pickupZone: { id: string; name: string };
  deliveryZone: { id: string; name: string };
}

export interface JobEvent {
  id: string;
  eventType: string;
  actor: string;
  description: string;
  details: unknown;
  createdAt: string;
}

export interface JobAssignment {
  id: string;
  jobId: string;
  riderId: string;
  reassignedFromId: string | null;
  status: AssignmentStatus;
  assignedAt: string;
  confirmationDeadline: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  rejectionReason: string | null;
  reassignmentReason: string | null;
  overrideReason: string | null;
  actor: string;
  capacityReserved: boolean;
  createdAt: string;
  updatedAt: string;
  rider: { id: string; name: string };
  reassignedFrom: {
    id: string;
    riderId: string;
    status: AssignmentStatus;
    assignedAt: string;
  } | null;
}

export interface JobTimeline {
  id: string;
  orderReference: string;
  events: JobEvent[];
}

export interface JobAuditEvent extends AuditEvent {
  description: string;
  details: unknown;
  createdAt: string;
}

export interface JobRecommendation {
  riderId: string;
  riderName: string;
  workload: number;
  maxCapacity: number;
  reservedCapacity: number;
  remainingCapacity: number;
  estimatedTravelTime: number;
  score: number;
  reasons: string[];
}

export interface JobRecommendations {
  jobId: string;
  recommendations: JobRecommendation[];
  excludedRiders: Array<{
    riderId: string;
    riderName: string;
    reason: string;
  }>;
}

export interface ManualQueueAssignmentAttempt {
  id: string;
  jobId: string;
  riderId: string;
  reassignedFromId: string | null;
  status: AssignmentStatus;
  assignedAt: string;
  confirmationDeadline: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  rejectionReason: string | null;
  reassignmentReason: string | null;
  overrideReason: string | null;
  actor: string;
  capacityReserved: boolean;
  createdAt: string;
  updatedAt: string;
  rider: { id: string; name: string };
}

export interface ManualQueueJob extends Job {
  assignmentAttemptCount: number;
  previousAssignmentHistory: ManualQueueAssignmentAttempt[];
  queuedAt: string;
  timeInQueueMs: number;
}

export interface ManualQueueJobDetails extends ManualQueueJob {
  events: JobEvent[];
  recommendations: JobRecommendation[];
  excludedRiders: JobRecommendations["excludedRiders"];
}

export interface Rider {
  id: string;
  name: string;
  phone: string;
  isAvailable: boolean;
  maxCapacity: number;
  reservedCapacity: number;
  createdAt: string;
  updatedAt: string;
  zones: Array<{ zone: { id: string; name: string } }>;
  activeAssignmentCount?: number;
  assignmentHistory?: RiderAssignment[];
  workload?: {
    maxCapacity: number;
    reservedCapacity: number;
    availableCapacity: number;
    activeAssignmentCount: number;
    activeAssignments: RiderAssignment[];
  };
}

export interface RiderAssignment {
  id: string;
  status: AssignmentStatus;
  assignedAt: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  rejectionReason: string | null;
  reassignmentReason: string | null;
  capacityReserved: boolean;
  job: {
    id: string;
    orderReference: string;
    requiredCapacity: number;
    status: JobStatus;
  };
}

export interface AuditEvent {
  id: string;
  jobId: string;
  eventType: string;
  actor: string;
  description: string;
  details: unknown;
  createdAt: string;
  job: { id: string; orderReference: string; status?: JobStatus };
  entityType: "JOB" | "ASSIGNMENT";
  entityId: string;
}
