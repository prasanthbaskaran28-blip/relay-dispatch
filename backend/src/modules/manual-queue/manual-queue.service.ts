import { z } from "zod";
import { AssignmentStatus, JobStatus, Prisma } from "@prisma/client";
import prisma from "../../config/database.js";
import { AppError } from "../../utils/app-error.js";
import {
  filterEligibleRiders,
  rankEligibleRiders,
  type RecommendationJob,
  type RecommendationRider,
} from "../recommendations/recommendation.logic.js";
import type { ManualQueueListQuery } from "./manual-queue.validation.js";

const retryResponseSchema = z.object({
  jobId: z.string(),
  recommendations: z.array(
    z.object({
      riderId: z.string(),
      riderName: z.string(),
      workload: z.number(),
      maxCapacity: z.number(),
      reservedCapacity: z.number(),
      remainingCapacity: z.number(),
      estimatedTravelTime: z.number(),
      score: z.number(),
      reasons: z.array(z.string()),
    }),
  ),
  excludedRiders: z.array(
    z.object({
      riderId: z.string(),
      riderName: z.string(),
      reason: z.string(),
    }),
  ),
});

const jobRelations = {
  pickupZone: { select: { id: true, name: true } },
  deliveryZone: { select: { id: true, name: true } },
  assignments: {
    include: { rider: { select: { id: true, name: true } } },
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
  },
} satisfies Prisma.JobInclude;

const recommendationRiderRelations = {
  zones: { select: { zone: { select: { id: true, name: true } } } },
  assignments: {
    where: {
      status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
      capacityReserved: true,
    },
    select: { jobId: true, status: true },
  },
} satisfies Prisma.RiderInclude;

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

function assertInManualQueue(job: { status: JobStatus }): void {
  if (job.status !== JobStatus.MANUAL_QUEUE) {
    throw new AppError(
      409,
      "JOB_NOT_IN_MANUAL_QUEUE",
      `A job in ${job.status} status is not in the manual queue.`,
    );
  }
}

function getRecommendations(
  job: RecommendationJob,
  riders: RecommendationRider[],
) {
  const { eligibleRiders, excludedRiders } = filterEligibleRiders(riders, job);
  return {
    recommendations: rankEligibleRiders(eligibleRiders, job, new Date()),
    excludedRiders,
  };
}

async function getRecommendationsForJob(
  transaction: Transaction,
  job: RecommendationJob,
) {
  const riders = await transaction.rider.findMany({
    include: recommendationRiderRelations,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return getRecommendations(job, riders);
}

function getJobQueueDetails<
  T extends {
    updatedAt: Date;
    assignments: unknown[];
  },
>(job: T, now: Date) {
  const { assignments, ...details } = job;
  return {
    ...details,
    assignmentAttemptCount: assignments.length,
    previousAssignmentHistory: assignments,
    queuedAt: job.updatedAt,
    timeInQueueMs: Math.max(0, now.getTime() - job.updatedAt.getTime()),
  };
}

export async function listManualQueue(query: ManualQueueListQuery) {
  const { page, pageSize, priority, pickupZoneId, deliveryZoneId, date, q } =
    query;
  const where: Prisma.JobWhereInput = { status: JobStatus.MANUAL_QUEUE };

  if (priority) where.priority = priority;
  if (pickupZoneId) where.pickupZoneId = pickupZoneId;
  if (deliveryZoneId) where.deliveryZoneId = deliveryZoneId;
  if (q) where.orderReference = { contains: q, mode: "insensitive" };
  if (date) {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    where.createdAt = { gte: start, lt: end };
  }

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      include: jobRelations,
      orderBy: [{ priority: "desc" }, { updatedAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.job.count({ where }),
  ]);
  const now = new Date();

  return {
    data: jobs.map((job) => getJobQueueDetails(job, now)),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getManualQueueJob(jobId: string) {
  return prisma.$transaction(async (transaction) => {
    await lockJob(transaction, jobId);
    const job = await transaction.job.findUnique({
      where: { id: jobId },
      include: {
        ...jobRelations,
        events: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            eventType: true,
            actor: true,
            description: true,
            details: true,
            createdAt: true,
          },
        },
      },
    });
    if (!job) {
      throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");
    }
    assertInManualQueue(job);
    const recommendationResults = await getRecommendationsForJob(
      transaction,
      job,
    );
    return {
      ...getJobQueueDetails(job, new Date()),
      ...recommendationResults,
    };
  });
}

export async function retryManualQueueJob(
  jobId: string,
  idempotencyKey: string,
) {
  return prisma.$transaction(async (transaction) => {
    await lockJob(transaction, jobId);
    const job = await transaction.job.findUnique({
      where: { id: jobId },
      include: jobRelations,
    });
    if (!job) {
      throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");
    }
    assertInManualQueue(job);
    const priorEvent = await transaction.jobEvent.findFirst({
      where: {
        jobId,
        eventType: "MANUAL_QUEUE_RETRY",
        idempotencyKey,
      },
      select: { id: true, details: true },
    });
    if (
      priorEvent?.details &&
      typeof priorEvent.details === "object" &&
      !Array.isArray(priorEvent.details)
    ) {
      const replay = retryResponseSchema.safeParse(priorEvent.details.response);
      if (replay.success && replay.data.jobId === job.id) return replay.data;
    }

    const recommendationResults = await getRecommendationsForJob(
      transaction,
      job,
    );
    if (!priorEvent) {
      await transaction.jobEvent.create({
        data: {
          jobId,
          eventType: "MANUAL_QUEUE_RETRY",
          idempotencyKey,
          actor: "api",
          description: "Rider recommendations recalculated for the manual queue.",
          details: {
            idempotencyKey,
            eligibleRiderCount: recommendationResults.recommendations.length,
            eligibleRiderIds: recommendationResults.recommendations.map(
              ({ riderId }) => riderId,
            ),
            requestedAt: new Date().toISOString(),
            response: { jobId: job.id, ...recommendationResults },
          },
        },
      });
    }
    return { jobId: job.id, ...recommendationResults };
  });
}

export async function dismissManualQueueJob(
  jobId: string,
  reason: string,
) {
  return prisma.$transaction(
    async (transaction) => {
      await lockJob(transaction, jobId);
      const job = await transaction.job.findUnique({
        where: { id: jobId },
        select: { id: true, status: true },
      });
      if (!job) {
        throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");
      }
      assertInManualQueue(job);

      const activeAssignment = await transaction.assignment.findFirst({
        where: {
          jobId,
          status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
          capacityReserved: true,
        },
        select: { id: true },
      });
      if (activeAssignment) {
        throw new AppError(
          409,
          "JOB_HAS_ACTIVE_ASSIGNMENT",
          "A job with an active assignment cannot be dismissed from the manual queue.",
        );
      }

      const update = await transaction.job.updateMany({
        where: { id: jobId, status: JobStatus.MANUAL_QUEUE },
        data: { status: JobStatus.CANCELLED },
      });
      if (update.count !== 1) {
        throw new AppError(
          409,
          "JOB_CHANGED",
          "The job changed while dismissal was being processed. Retry the request.",
        );
      }

      const dismissedJob = await transaction.job.findUniqueOrThrow({
        where: { id: jobId },
        include: jobRelations,
      });
      await transaction.jobEvent.create({
        data: {
          jobId,
          eventType: "MANUAL_QUEUE_DISMISSED",
          actor: "api",
          description: "Delivery job dismissed from the manual queue.",
          details: {
            reason,
            previousStatus: JobStatus.MANUAL_QUEUE,
            newStatus: JobStatus.CANCELLED,
          },
        },
      });
      return dismissedJob;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
