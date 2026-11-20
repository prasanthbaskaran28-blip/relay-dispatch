import {
  AssignmentStatus,
  JobStatus,
  Prisma,
} from "@prisma/client";
import prisma from "../../config/database.js";
import { AppError } from "../../utils/app-error.js";

const activeAssignmentStatuses = [
  AssignmentStatus.PENDING,
  AssignmentStatus.ACCEPTED,
];

const lifecycleJobRelations = {
  pickupZone: { select: { id: true, name: true } },
  deliveryZone: { select: { id: true, name: true } },
  assignments: {
    include: { rider: { select: { id: true, name: true } } },
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
  },
} satisfies Prisma.JobInclude;

type Transaction = Prisma.TransactionClient;

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

async function findJobForTransition(
  transaction: Transaction,
  jobId: string,
) {
  const job = await transaction.job.findUnique({
    where: { id: jobId },
    select: { id: true, orderReference: true, status: true, requiredCapacity: true },
  });
  if (!job) {
    throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");
  }
  return job;
}

async function transitionJob(
  transaction: Transaction,
  jobId: string,
  currentStatus: JobStatus,
  nextStatus: JobStatus,
): Promise<void> {
  const result = await transaction.job.updateMany({
    where: { id: jobId, status: currentStatus },
    data: { status: nextStatus },
  });
  if (result.count !== 1) {
    throw new AppError(
      409,
      "JOB_CHANGED",
      "The job changed while this lifecycle transition was being processed.",
    );
  }
}

async function getActiveAssignment(
  transaction: Transaction,
  jobId: string,
  status: AssignmentStatus,
) {
  const assignments = await transaction.assignment.findMany({
    where: { jobId, status, capacityReserved: true },
    select: { id: true, riderId: true, capacityReserved: true },
    orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
  });
  if (assignments.length !== 1) {
    throw new AppError(
      409,
      "ACTIVE_ASSIGNMENT_REQUIRED",
      "The job must have exactly one active reserved assignment for this transition.",
    );
  }
  return assignments[0]!;
}

export async function pickUpJob(jobId: string) {
  return prisma.$transaction(
    async (transaction) => {
      await lockJob(transaction, jobId);
      const job = await findJobForTransition(transaction, jobId);
      if (job.status !== JobStatus.ACCEPTED) {
        throw new AppError(
          409,
          "JOB_NOT_READY_FOR_PICKUP",
          `A job in ${job.status} status cannot be picked up.`,
        );
      }

      const assignment = await getActiveAssignment(
        transaction,
        jobId,
        AssignmentStatus.ACCEPTED,
      );
      const pickedUpAt = new Date();
      await transitionJob(
        transaction,
        jobId,
        JobStatus.ACCEPTED,
        JobStatus.PICKED_UP,
      );
      await transaction.jobEvent.create({
        data: {
          jobId,
          eventType: "JOB_PICKED_UP",
          actor: "api",
          description: "Delivery job picked up by the assigned rider.",
          details: {
            assignmentId: assignment.id,
            riderId: assignment.riderId,
            pickedUpAt: pickedUpAt.toISOString(),
          },
        },
      });
      return transaction.job.findUniqueOrThrow({
        where: { id: jobId },
        include: lifecycleJobRelations,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function deliverJob(jobId: string) {
  return prisma.$transaction(
    async (transaction) => {
      await lockJob(transaction, jobId);
      const job = await findJobForTransition(transaction, jobId);
      if (job.status !== JobStatus.PICKED_UP) {
        throw new AppError(
          409,
          "JOB_NOT_PICKED_UP",
          `A job in ${job.status} status cannot be delivered.`,
        );
      }

      const assignment = await getActiveAssignment(
        transaction,
        jobId,
        AssignmentStatus.ACCEPTED,
      );
      await lockRider(transaction, assignment.riderId);

      const assignmentUpdate = await transaction.assignment.updateMany({
        where: {
          id: assignment.id,
          jobId,
          status: AssignmentStatus.ACCEPTED,
          capacityReserved: true,
        },
        data: {
          status: AssignmentStatus.COMPLETED,
          capacityReserved: false,
        },
      });
      if (assignmentUpdate.count !== 1) {
        throw new AppError(
          409,
          "ASSIGNMENT_CHANGED",
          "The active assignment changed while the job was being delivered.",
        );
      }

      const capacityRelease = await transaction.rider.updateMany({
        where: {
          id: assignment.riderId,
          reservedCapacity: { gte: job.requiredCapacity },
        },
        data: { reservedCapacity: { decrement: job.requiredCapacity } },
      });
      if (capacityRelease.count !== 1) {
        throw new AppError(
          409,
          "CAPACITY_RESERVATION_MISMATCH",
          "The rider's reserved capacity could not be released.",
        );
      }

      const deliveredAt = new Date();
      await transitionJob(
        transaction,
        jobId,
        JobStatus.PICKED_UP,
        JobStatus.DELIVERED,
      );
      await transaction.jobEvent.create({
        data: {
          jobId,
          eventType: "JOB_DELIVERED",
          actor: "api",
          description: "Delivery job delivered successfully.",
          details: {
            assignmentId: assignment.id,
            riderId: assignment.riderId,
            requiredCapacity: job.requiredCapacity,
            capacityReleased: true,
            deliveredAt: deliveredAt.toISOString(),
          },
        },
      });
      return transaction.job.findUniqueOrThrow({
        where: { id: jobId },
        include: lifecycleJobRelations,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function cancelJob(jobId: string, reason: string) {
  return prisma.$transaction(
    async (transaction) => {
      await lockJob(transaction, jobId);
      const job = await findJobForTransition(transaction, jobId);
      const cancellableStatuses: JobStatus[] = [
        JobStatus.NEW,
        JobStatus.READY_FOR_ASSIGNMENT,
        JobStatus.AWAITING_CONFIRMATION,
        JobStatus.ACCEPTED,
        JobStatus.MANUAL_QUEUE,
      ];
      if (!cancellableStatuses.includes(job.status)) {
        throw new AppError(
          409,
          "JOB_NOT_CANCELLABLE",
          `A job in ${job.status} status cannot be cancelled.`,
        );
      }

      const activeAssignments = await transaction.assignment.findMany({
        where: {
          jobId,
          status: { in: activeAssignmentStatuses },
        },
        select: {
          id: true,
          riderId: true,
          status: true,
          capacityReserved: true,
        },
        orderBy: [{ riderId: "asc" }, { id: "asc" }],
      });
      if (activeAssignments.some(({ capacityReserved }) => !capacityReserved)) {
        throw new AppError(
          409,
          "ASSIGNMENT_CAPACITY_NOT_RESERVED",
          "An active assignment does not hold its required capacity reservation.",
        );
      }

      for (const riderId of [
        ...new Set(activeAssignments.map(({ riderId }) => riderId)),
      ].sort()) {
        await lockRider(transaction, riderId);
      }

      for (const assignment of activeAssignments) {
        const update = await transaction.assignment.updateMany({
          where: {
            id: assignment.id,
            jobId,
            status: assignment.status,
            capacityReserved: true,
          },
          data: {
            status: AssignmentStatus.CANCELLED,
            capacityReserved: false,
          },
        });
        if (update.count !== 1) {
          throw new AppError(
            409,
            "ASSIGNMENT_CHANGED",
            "An active assignment changed while the job was being cancelled.",
          );
        }

        const release = await transaction.rider.updateMany({
          where: {
            id: assignment.riderId,
            reservedCapacity: { gte: job.requiredCapacity },
          },
          data: { reservedCapacity: { decrement: job.requiredCapacity } },
        });
        if (release.count !== 1) {
          throw new AppError(
            409,
            "CAPACITY_RESERVATION_MISMATCH",
            "The rider's reserved capacity could not be released.",
          );
        }
      }

      await transitionJob(
        transaction,
        jobId,
        job.status,
        JobStatus.CANCELLED,
      );
      const cancelledAt = new Date();
      await transaction.jobEvent.create({
        data: {
          jobId,
          eventType: "JOB_CANCELLED",
          actor: "api",
          description: "Delivery job cancelled.",
          details: {
            reason,
            previousStatus: job.status,
            newStatus: JobStatus.CANCELLED,
            assignmentIds: activeAssignments.map(({ id }) => id),
            riderIds: [...new Set(activeAssignments.map(({ riderId }) => riderId))],
            requiredCapacity: job.requiredCapacity,
            capacityReleasedAssignmentIds: activeAssignments.map(
              ({ id }) => id,
            ),
            cancelledAt: cancelledAt.toISOString(),
          },
        },
      });
      return transaction.job.findUniqueOrThrow({
        where: { id: jobId },
        include: lifecycleJobRelations,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function getJobTimeline(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, orderReference: true },
  });
  if (!job) {
    throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");
  }

  const events = await prisma.jobEvent.findMany({
    where: { jobId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      eventType: true,
      actor: true,
      description: true,
      details: true,
      createdAt: true,
    },
  });
  return { ...job, events };
}
