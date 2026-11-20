import {
  AssignmentStatus,
  JobStatus,
  Prisma,
} from "@prisma/client";
import prisma from "../../config/database.js";
import { AppError } from "../../utils/app-error.js";
import {
  filterEligibleRiders,
  rankEligibleRiders,
  type RecommendationJob,
} from "../recommendations/recommendation.logic.js";
import {
  assertReassignmentAllowed,
  assertJobAssignable,
  assertOverrideReason,
  assertAssignmentResponseAllowed,
} from "./assignment.logic.js";
import {
  assignmentActor,
  confirmationWindowMinutes,
} from "./assignment.config.js";
import type {
  CreateAssignmentInput,
  CreateReassignmentInput,
} from "./assignment.validation.js";

const activeAssignmentStatuses = [
  AssignmentStatus.PENDING,
  AssignmentStatus.ACCEPTED,
];

const jobRelations = {
  pickupZone: { select: { id: true, name: true } },
  deliveryZone: { select: { id: true, name: true } },
} satisfies Prisma.JobInclude;

const recommendationRiderRelations = {
  zones: { select: { zone: { select: { id: true, name: true } } } },
  assignments: {
    where: {
      status: { in: activeAssignmentStatuses },
      capacityReserved: true,
    },
    select: { jobId: true, status: true },
  },
} satisfies Prisma.RiderInclude;

const assignmentScalarSelect = {
  id: true,
  jobId: true,
  riderId: true,
  reassignedFromId: true,
  status: true,
  assignedAt: true,
  confirmationDeadline: true,
  confirmedAt: true,
  rejectedAt: true,
  expiredAt: true,
  rejectionReason: true,
  reassignmentReason: true,
  overrideReason: true,
  actor: true,
  capacityReserved: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AssignmentSelect;

const assignmentResponseSelect = {
  ...assignmentScalarSelect,
  rider: { select: { id: true, name: true } },
  reassignedFrom: {
    select: { id: true, riderId: true, status: true, assignedAt: true },
  },
} satisfies Prisma.AssignmentSelect;

type AssignmentWithRelations = Prisma.AssignmentGetPayload<{
  select: typeof assignmentResponseSelect;
}>;

type Transaction = Prisma.TransactionClient;

function isKnownRequestError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

function isTransactionConflict(error: unknown): boolean {
  if (!isKnownRequestError(error)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;
  const databaseCode = error.meta?.code;
  return (
    typeof databaseCode === "string" &&
    (databaseCode === "40001" || databaseCode === "40P01")
  );
}

function assertSameCreateRequest(
  assignment: AssignmentWithRelations,
  jobId: string,
  input: CreateAssignmentInput,
): void {
  if (
    assignment.jobId !== jobId ||
    assignment.riderId !== input.riderId ||
    assignment.reassignedFromId !== null ||
    assignment.overrideReason !== (input.overrideReason ?? null)
  ) {
    throw new AppError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This idempotency key was already used with a different request.",
    );
  }
}

function assertSameReassignmentRequest(
  assignment: AssignmentWithRelations,
  jobId: string,
  input: CreateReassignmentInput,
): void {
  if (
    assignment.jobId !== jobId ||
    assignment.riderId !== input.riderId ||
    assignment.reassignedFromId !== input.assignmentId ||
    assignment.overrideReason !== (input.overrideReason ?? null) ||
    assignment.reassignmentReason !== (input.reassignmentReason ?? null)
  ) {
    throw new AppError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This idempotency key was already used with a different request.",
    );
  }
}

async function findIdempotentAssignment(
  transaction: Transaction,
  idempotencyKey: string,
): Promise<AssignmentWithRelations | null> {
  return transaction.assignment.findUnique({
    where: { idempotencyKey },
    select: assignmentResponseSelect,
  });
}

async function lockJob(
  transaction: Transaction,
  jobId: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Job" WHERE "id" = ${jobId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");
  }
}

async function lockRider(
  transaction: Transaction,
  riderId: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Rider" WHERE "id" = ${riderId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new AppError(404, "RIDER_NOT_FOUND", "Rider not found.");
  }
}

async function getEligibleSelection(
  transaction: Transaction,
  job: RecommendationJob,
  riderId: string,
  overrideReason?: string,
) {
  const riders = await transaction.rider.findMany({
    include: recommendationRiderRelations,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const { eligibleRiders, excludedRiders } = filterEligibleRiders(riders, job);
  const selected = eligibleRiders.find(({ rider }) => rider.id === riderId);

  if (!selected) {
    const exclusion = excludedRiders.find(
      (candidate) => candidate.riderId === riderId,
    );
    throw new AppError(
      409,
      "RIDER_NOT_ELIGIBLE",
      exclusion?.reason ?? "Rider is not eligible for this job.",
    );
  }

  const rank = rankEligibleRiders(eligibleRiders, job, new Date()).findIndex(
    (recommendation) => recommendation.riderId === riderId,
  );
  assertOverrideReason(rank, overrideReason);

  return selected.rider;
}

async function reserveCapacity(
  transaction: Transaction,
  rider: {
    id: string;
    isAvailable: boolean;
    maxCapacity: number;
    reservedCapacity: number;
  },
  requiredCapacity: number,
): Promise<void> {
  if (rider.maxCapacity - rider.reservedCapacity < requiredCapacity) {
    throw new AppError(
      409,
      "INSUFFICIENT_CAPACITY",
      "Rider has insufficient remaining capacity.",
    );
  }

  const result = await transaction.rider.updateMany({
    where: {
      id: rider.id,
      isAvailable: true,
      maxCapacity: rider.maxCapacity,
      reservedCapacity: rider.reservedCapacity,
    },
    data: { reservedCapacity: { increment: requiredCapacity } },
  });
  if (result.count !== 1) {
    throw new AppError(
      409,
      "RIDER_CHANGED",
      "Rider availability or capacity changed. Retry with a fresh recommendation.",
    );
  }
}

async function createPendingAssignment(
  transaction: Transaction,
  values: {
    jobId: string;
    riderId: string;
    idempotencyKey: string;
    overrideReason?: string;
    reassignedFromId?: string;
    reassignmentReason?: string;
    now: Date;
  },
): Promise<AssignmentWithRelations> {
  return transaction.assignment.create({
    data: {
      jobId: values.jobId,
      riderId: values.riderId,
      status: AssignmentStatus.PENDING,
      assignedAt: values.now,
      confirmationDeadline: new Date(
        values.now.getTime() + confirmationWindowMinutes * 60_000,
      ),
      capacityReserved: true,
      idempotencyKey: values.idempotencyKey,
      overrideReason: values.overrideReason ?? null,
      reassignedFromId: values.reassignedFromId ?? null,
      reassignmentReason: values.reassignmentReason ?? null,
      actor: assignmentActor,
    },
    select: assignmentResponseSelect,
  });
}

async function findCommittedReplay(
  idempotencyKey: string,
): Promise<AssignmentWithRelations | null> {
  return prisma.assignment.findUnique({
    where: { idempotencyKey },
    select: assignmentResponseSelect,
  });
}

async function recoverCreateConflict(
  error: unknown,
  jobId: string,
  input: CreateAssignmentInput,
  idempotencyKey: string,
): Promise<{ assignment: AssignmentWithRelations; replayed: true }> {
  if (
    !isKnownRequestError(error) ||
    (error.code !== "P2002" && !isTransactionConflict(error))
  ) {
    throw error;
  }
  const existing = await findCommittedReplay(idempotencyKey);
  if (existing) {
    assertSameCreateRequest(existing, jobId, input);
    return { assignment: existing, replayed: true };
  }
  if (isTransactionConflict(error)) {
    throw new AppError(
      409,
      "ASSIGNMENT_CONFLICT",
      "The job or rider changed concurrently. Retry with the same idempotency key.",
    );
  }
  throw new AppError(
    409,
    "ASSIGNMENT_CONFLICT",
    "The assignment conflicts with an existing request.",
  );
}

async function recoverReassignmentConflict(
  error: unknown,
  jobId: string,
  input: CreateReassignmentInput,
  idempotencyKey: string,
): Promise<{ assignment: AssignmentWithRelations; replayed: true }> {
  if (
    !isKnownRequestError(error) ||
    (error.code !== "P2002" && !isTransactionConflict(error))
  ) {
    throw error;
  }
  const existing = await findCommittedReplay(idempotencyKey);
  if (existing) {
    assertSameReassignmentRequest(existing, jobId, input);
    return { assignment: existing, replayed: true };
  }
  if (isTransactionConflict(error)) {
    throw new AppError(
      409,
      "ASSIGNMENT_CONFLICT",
      "The job or rider changed concurrently. Retry with the same idempotency key.",
    );
  }
  throw new AppError(
    409,
    "ASSIGNMENT_CONFLICT",
    "The assignment conflicts with an existing request.",
  );
}

export async function createAssignment(
  jobId: string,
  input: CreateAssignmentInput,
  idempotencyKey: string,
): Promise<{ assignment: AssignmentWithRelations; replayed: boolean }> {
  try {
    return await prisma.$transaction(
      async (transaction) => {
        const existing = await findIdempotentAssignment(
          transaction,
          idempotencyKey,
        );
        if (existing) {
          assertSameCreateRequest(existing, jobId, input);
          return { assignment: existing, replayed: true };
        }

        await lockJob(transaction, jobId);
        const job = await transaction.job.findUnique({
          where: { id: jobId },
          include: jobRelations,
        });
        if (!job) {
          throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");
        }
        assertJobAssignable(job.status);

        const activeAssignment = await transaction.assignment.findFirst({
          where: {
            jobId,
            status: { in: activeAssignmentStatuses },
          },
          select: { id: true },
        });
        if (activeAssignment) {
          throw new AppError(
            409,
            "JOB_ALREADY_ASSIGNED",
            "The job already has an active assignment.",
          );
        }

        await lockRider(transaction, input.riderId);
        const rider = await getEligibleSelection(
          transaction,
          job,
          input.riderId,
          input.overrideReason,
        );
        await reserveCapacity(transaction, rider, job.requiredCapacity);

        const now = new Date();
        const assignment = await createPendingAssignment(transaction, {
          jobId,
          riderId: input.riderId,
          idempotencyKey,
          overrideReason: input.overrideReason,
          now,
        });

        const jobUpdate = await transaction.job.updateMany({
          where: {
            id: jobId,
            status: {
              in: [
                JobStatus.NEW,
                JobStatus.READY_FOR_ASSIGNMENT,
                JobStatus.MANUAL_QUEUE,
              ],
            },
          },
          data: { status: JobStatus.AWAITING_CONFIRMATION },
        });
        if (jobUpdate.count !== 1) {
          throw new AppError(
            409,
            "JOB_CHANGED",
            "The job changed while the assignment was being processed.",
          );
        }

        await transaction.jobEvent.create({
          data: {
            jobId,
            eventType: "ASSIGNMENT_CREATED",
            actor: assignmentActor,
            description: "A rider was assigned to the delivery job.",
            details: {
              assignmentId: assignment.id,
              riderId: assignment.riderId,
              requiredCapacity: job.requiredCapacity,
              capacityReserved: true,
              confirmationDeadline: assignment.confirmationDeadline.toISOString(),
              overrideReason: input.overrideReason ?? null,
              actor: assignmentActor,
            },
          },
        });

        return { assignment, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    return recoverCreateConflict(error, jobId, input, idempotencyKey);
  }
}

export async function reassignJob(
  jobId: string,
  input: CreateReassignmentInput,
  idempotencyKey: string,
): Promise<{ assignment: AssignmentWithRelations; replayed: boolean }> {
  try {
    return await prisma.$transaction(
      async (transaction) => {
        const existing = await findIdempotentAssignment(
          transaction,
          idempotencyKey,
        );
        if (existing) {
          assertSameReassignmentRequest(existing, jobId, input);
          return { assignment: existing, replayed: true };
        }

        await lockJob(transaction, jobId);
        const job = await transaction.job.findUnique({
          where: { id: jobId },
          include: jobRelations,
        });
        if (!job) {
          throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");
        }

        const lockedAssignment =
          await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Assignment"
            WHERE "id" = ${input.assignmentId} AND "jobId" = ${jobId}
            FOR UPDATE
          `;
        if (lockedAssignment.length === 0) {
          throw new AppError(
            404,
            "ASSIGNMENT_NOT_FOUND",
            "Assignment was not found for this job.",
          );
        }

        const previous = await transaction.assignment.findUnique({
          where: { id: input.assignmentId },
          select: {
            id: true,
            riderId: true,
            status: true,
            capacityReserved: true,
          },
        });
        if (!previous) {
          throw new AppError(
            404,
            "ASSIGNMENT_NOT_FOUND",
            "Assignment was not found for this job.",
          );
        }

        assertReassignmentAllowed(
          job.status,
          previous.status,
          input.reassignmentReason,
        );
        if (!previous.capacityReserved) {
          throw new AppError(
            409,
            "ASSIGNMENT_CAPACITY_NOT_RESERVED",
            "The previous assignment no longer holds a capacity reservation.",
          );
        }
        if (previous.riderId === input.riderId) {
          throw new AppError(
            409,
            "SAME_RIDER_REASSIGNMENT",
            "Select a different rider to reassign this job.",
          );
        }

        const duplicateActive = await transaction.assignment.findFirst({
          where: {
            jobId,
            id: { not: previous.id },
            status: { in: activeAssignmentStatuses },
          },
          select: { id: true },
        });
        if (duplicateActive) {
          throw new AppError(
            409,
            "DUPLICATE_ACTIVE_ASSIGNMENT",
            "Another active assignment already exists for this job.",
          );
        }

        for (const riderId of [previous.riderId, input.riderId].sort()) {
          await lockRider(transaction, riderId);
        }
        const rider = await getEligibleSelection(
          transaction,
          job,
          input.riderId,
          input.overrideReason,
        );
        await reserveCapacity(transaction, rider, job.requiredCapacity);

        const previousUpdate = await transaction.assignment.updateMany({
          where: {
            id: previous.id,
            status: previous.status,
            capacityReserved: true,
          },
          data: {
            status: AssignmentStatus.REASSIGNED,
            capacityReserved: false,
            reassignmentReason: input.reassignmentReason ?? null,
          },
        });
        if (previousUpdate.count !== 1) {
          throw new AppError(
            409,
            "ASSIGNMENT_CHANGED",
            "The previous assignment changed while reassignment was being processed.",
          );
        }

        const release = await transaction.rider.updateMany({
          where: {
            id: previous.riderId,
            reservedCapacity: { gte: job.requiredCapacity },
          },
          data: { reservedCapacity: { decrement: job.requiredCapacity } },
        });
        if (release.count !== 1) {
          throw new AppError(
            409,
            "CAPACITY_RESERVATION_MISMATCH",
            "The previous rider's reserved capacity could not be released.",
          );
        }

        const now = new Date();
        const assignment = await createPendingAssignment(transaction, {
          jobId,
          riderId: input.riderId,
          idempotencyKey,
          overrideReason: input.overrideReason,
          reassignedFromId: previous.id,
          reassignmentReason: input.reassignmentReason,
          now,
        });

        const jobUpdate = await transaction.job.updateMany({
          where: {
            id: jobId,
            status: { in: [JobStatus.AWAITING_CONFIRMATION, JobStatus.ACCEPTED] },
          },
          data: { status: JobStatus.AWAITING_CONFIRMATION },
        });
        if (jobUpdate.count !== 1) {
          throw new AppError(
            409,
            "JOB_CHANGED",
            "The job changed while reassignment was being processed.",
          );
        }

        await transaction.jobEvent.create({
          data: {
            jobId,
            eventType: "ASSIGNMENT_REASSIGNED",
            actor: assignmentActor,
            description: "The job was reassigned to another rider.",
            details: {
              previousAssignmentId: previous.id,
              previousRiderId: previous.riderId,
              assignmentId: assignment.id,
              riderId: assignment.riderId,
              requiredCapacity: job.requiredCapacity,
              capacityReleasedForPreviousAssignment: true,
              capacityReservedForNewAssignment: true,
              reassignmentReason: input.reassignmentReason ?? null,
              overrideReason: input.overrideReason ?? null,
              actor: assignmentActor,
            },
          },
        });

        return { assignment, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    return recoverReassignmentConflict(error, jobId, input, idempotencyKey);
  }
}

async function respondToAssignment(
  assignmentId: string,
  responseType: "accept" | "reject",
  rejectionReason?: string,
): Promise<AssignmentWithRelations> {
  return prisma.$transaction(
    async (transaction) => {
      const locator = await transaction.assignment.findUnique({
        where: { id: assignmentId },
        select: { jobId: true },
      });
      if (!locator) {
        throw new AppError(
          404,
          "ASSIGNMENT_NOT_FOUND",
          "Assignment not found.",
        );
      }

      await lockJob(transaction, locator.jobId);
      const lockedAssignment =
        await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Assignment"
          WHERE "id" = ${assignmentId} AND "jobId" = ${locator.jobId}
          FOR UPDATE
        `;
      if (lockedAssignment.length === 0) {
        throw new AppError(
          404,
          "ASSIGNMENT_NOT_FOUND",
          "Assignment not found.",
        );
      }

      const assignment = await transaction.assignment.findUnique({
        where: { id: assignmentId },
        select: {
          ...assignmentScalarSelect,
          jobId: true,
          riderId: true,
        },
      });
      if (!assignment || assignment.jobId !== locator.jobId) {
        throw new AppError(
          404,
          "ASSIGNMENT_NOT_FOUND",
          "Assignment not found.",
        );
      }

      const job = await transaction.job.findUnique({
        where: { id: assignment.jobId },
        select: { id: true, status: true, requiredCapacity: true },
      });
      if (!job) {
        throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");
      }

      const now = new Date();
      assertAssignmentResponseAllowed(
        assignment.status,
        job.status,
        assignment.confirmationDeadline,
        now,
      );
      if (!assignment.capacityReserved) {
        throw new AppError(
          409,
          "ASSIGNMENT_CAPACITY_NOT_RESERVED",
          "The assignment no longer holds a capacity reservation.",
        );
      }

      const replacement = await transaction.assignment.findFirst({
        where: {
          reassignedFromId: assignmentId,
          status: { in: activeAssignmentStatuses },
          capacityReserved: true,
        },
        select: { id: true },
      });
      if (replacement) {
        throw new AppError(
          409,
          "ASSIGNMENT_NOT_CURRENT",
          "This assignment has been replaced and can no longer be answered.",
        );
      }

      if (responseType === "accept") {
        const updated = await transaction.assignment.updateMany({
          where: {
            id: assignmentId,
            jobId: job.id,
            status: AssignmentStatus.PENDING,
            capacityReserved: true,
            confirmationDeadline: { gt: now },
          },
          data: {
            status: AssignmentStatus.ACCEPTED,
            confirmedAt: now,
          },
        });
        if (updated.count !== 1) {
          throw new AppError(
            409,
            "ASSIGNMENT_CHANGED",
            "The assignment changed while the response was being processed.",
          );
        }

        const jobUpdate = await transaction.job.updateMany({
          where: {
            id: job.id,
            status: JobStatus.AWAITING_CONFIRMATION,
          },
          data: { status: JobStatus.ACCEPTED },
        });
        if (jobUpdate.count !== 1) {
          throw new AppError(
            409,
            "JOB_CHANGED",
            "The job changed while the response was being processed.",
          );
        }
      } else {
        const updated = await transaction.assignment.updateMany({
          where: {
            id: assignmentId,
            jobId: job.id,
            status: AssignmentStatus.PENDING,
            capacityReserved: true,
            confirmationDeadline: { gt: now },
          },
          data: {
            status: AssignmentStatus.REJECTED,
            rejectedAt: now,
            rejectionReason,
            capacityReserved: false,
          },
        });
        if (updated.count !== 1) {
          throw new AppError(
            409,
            "ASSIGNMENT_CHANGED",
            "The assignment changed while the response was being processed.",
          );
        }

        await lockRider(transaction, assignment.riderId);
        const released = await transaction.rider.updateMany({
          where: {
            id: assignment.riderId,
            reservedCapacity: { gte: job.requiredCapacity },
          },
          data: {
            reservedCapacity: { decrement: job.requiredCapacity },
          },
        });
        if (released.count !== 1) {
          throw new AppError(
            409,
            "CAPACITY_RESERVATION_MISMATCH",
            "The rider's reserved capacity could not be released.",
          );
        }

        const otherValidAssignment = await transaction.assignment.findFirst({
          where: {
            jobId: job.id,
            id: { not: assignmentId },
            status: { in: activeAssignmentStatuses },
            capacityReserved: true,
          },
          select: { id: true },
        });
        if (!otherValidAssignment) {
          const jobUpdate = await transaction.job.updateMany({
            where: {
              id: job.id,
              status: JobStatus.AWAITING_CONFIRMATION,
            },
            data: { status: JobStatus.MANUAL_QUEUE },
          });
          if (jobUpdate.count !== 1) {
            throw new AppError(
              409,
              "JOB_CHANGED",
              "The job changed while the response was being processed.",
            );
          }
        }
      }

      await transaction.jobEvent.create({
        data: {
          jobId: job.id,
          eventType:
            responseType === "accept"
              ? "ASSIGNMENT_ACCEPTED"
              : "ASSIGNMENT_REJECTED",
          actor: assignmentActor,
          description:
            responseType === "accept"
              ? "The rider accepted the delivery assignment."
              : "The rider rejected the delivery assignment.",
          details: {
            assignmentId,
            riderId: assignment.riderId,
            requiredCapacity: job.requiredCapacity,
            capacityReleased: responseType === "reject",
            ...(responseType === "reject" ? { rejectionReason } : {}),
            respondedAt: now.toISOString(),
          },
        },
      });

      return transaction.assignment.findUniqueOrThrow({
        where: { id: assignmentId },
        select: assignmentResponseSelect,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export function acceptAssignment(assignmentId: string) {
  return respondToAssignment(assignmentId, "accept");
}

export function rejectAssignment(
  assignmentId: string,
  rejectionReason: string,
) {
  return respondToAssignment(assignmentId, "reject", rejectionReason);
}

export async function getJobAssignmentHistory(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true },
  });
  if (!job) throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");

  return prisma.assignment.findMany({
    where: { jobId },
    select: assignmentResponseSelect,
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
  });
}

export async function getAssignmentById(assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      ...assignmentScalarSelect,
      rider: { select: { id: true, name: true } },
      job: {
        select: {
          id: true,
          orderReference: true,
          status: true,
          requiredCapacity: true,
        },
      },
      reassignedFrom: {
        select: {
          id: true,
          riderId: true,
          status: true,
          assignedAt: true,
          reassignmentReason: true,
        },
      },
      reassignments: {
        select: {
          id: true,
          riderId: true,
          status: true,
          assignedAt: true,
          reassignmentReason: true,
        },
        orderBy: { assignedAt: "asc" },
      },
    },
  });
  if (!assignment) {
    throw new AppError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found.");
  }
  return assignment;
}
