import { AssignmentStatus, JobStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error.js";

const assignableJobStatuses: JobStatus[] = [
  JobStatus.NEW,
  JobStatus.READY_FOR_ASSIGNMENT,
  JobStatus.MANUAL_QUEUE,
];

export function assertJobAssignable(status: JobStatus): void {
  if (!assignableJobStatuses.includes(status)) {
    throw new AppError(
      409,
      "JOB_NOT_ASSIGNABLE",
      `A job in ${status} status cannot be assigned.`,
    );
  }
}

export function assertOverrideReason(
  recommendationPosition: number,
  overrideReason?: string,
): void {
  if (recommendationPosition > 0 && !overrideReason) {
    throw new AppError(
      400,
      "OVERRIDE_REASON_REQUIRED",
      "A reason is required when selecting a rider below the top recommendation.",
    );
  }
}

export function assertReassignmentAllowed(
  jobStatus: JobStatus,
  assignmentStatus: AssignmentStatus,
  reassignmentReason?: string,
): void {
  if (
    jobStatus === JobStatus.PICKED_UP ||
    jobStatus === JobStatus.DELIVERED ||
    jobStatus === JobStatus.CANCELLED
  ) {
    throw new AppError(
      409,
      "JOB_NOT_REASSIGNABLE",
      `A job in ${jobStatus} status cannot be reassigned.`,
    );
  }
  if (
    jobStatus !== JobStatus.AWAITING_CONFIRMATION &&
    jobStatus !== JobStatus.ACCEPTED
  ) {
    throw new AppError(
      409,
      "JOB_NOT_REASSIGNABLE",
      `A job in ${jobStatus} status cannot be reassigned.`,
    );
  }
  if (
    assignmentStatus !== AssignmentStatus.PENDING &&
    assignmentStatus !== AssignmentStatus.ACCEPTED
  ) {
    throw new AppError(
      409,
      "ASSIGNMENT_NOT_ACTIVE",
      "Only pending or accepted assignments can be reassigned.",
    );
  }
  if (
    (assignmentStatus === AssignmentStatus.PENDING &&
      jobStatus !== JobStatus.AWAITING_CONFIRMATION) ||
    (assignmentStatus === AssignmentStatus.ACCEPTED &&
      jobStatus !== JobStatus.ACCEPTED)
  ) {
    throw new AppError(
      409,
      "ASSIGNMENT_JOB_STATE_MISMATCH",
      "The assignment and job lifecycle states do not match.",
    );
  }
  if (
    assignmentStatus === AssignmentStatus.ACCEPTED &&
    !reassignmentReason
  ) {
    throw new AppError(
      400,
      "REASSIGNMENT_REASON_REQUIRED",
      "A reason is required when replacing an accepted assignment.",
    );
  }
}

export function assertAssignmentResponseAllowed(
  assignmentStatus: AssignmentStatus,
  jobStatus: JobStatus,
  confirmationDeadline: Date,
  now: Date,
): void {
  if (assignmentStatus !== AssignmentStatus.PENDING) {
    throw new AppError(
      409,
      "ASSIGNMENT_NOT_PENDING",
      "Only pending assignments can be accepted or rejected.",
    );
  }
  if (jobStatus !== JobStatus.AWAITING_CONFIRMATION) {
    throw new AppError(
      409,
      "ASSIGNMENT_JOB_STATE_MISMATCH",
      "The assignment and job lifecycle states do not match.",
    );
  }
  if (confirmationDeadline.getTime() <= now.getTime()) {
    throw new AppError(
      409,
      "ASSIGNMENT_EXPIRED",
      "The assignment confirmation deadline has passed.",
    );
  }
}
