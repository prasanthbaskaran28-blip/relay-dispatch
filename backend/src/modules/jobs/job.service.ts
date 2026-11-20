import { JobPriority, JobStatus, Prisma } from "@prisma/client";
import prisma from "../../config/database.js";
import { AppError } from "../../utils/app-error.js";
import type {
  CreateJobInput,
  ListJobsQuery,
  UpdateJobInput,
} from "./job.validation.js";

const jobRelations = {
  pickupZone: { select: { id: true, name: true } },
  deliveryZone: { select: { id: true, name: true } },
} satisfies Prisma.JobInclude;

const jobDetailsRelations = {
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
} satisfies Prisma.JobInclude;

type JobWithZones = Prisma.JobGetPayload<{ include: typeof jobRelations }>;

const editableStatuses: JobStatus[] = [
  JobStatus.NEW,
  JobStatus.READY_FOR_ASSIGNMENT,
  JobStatus.MANUAL_QUEUE,
];

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function hasSameCreatePayload(
  job: JobWithZones,
  input: CreateJobInput,
): boolean {
  return (
    job.orderReference === input.orderReference &&
    job.pickupZoneId === input.pickupZoneId &&
    job.deliveryZoneId === input.deliveryZoneId &&
    job.requiredCapacity === input.requiredCapacity &&
    job.priority === (input.priority ?? JobPriority.NORMAL) &&
    job.deadline?.getTime() === input.deadline?.getTime()
  );
}

async function assertZonesExist(
  transaction: Prisma.TransactionClient,
  zoneIds: Array<string | undefined>,
): Promise<void> {
  const requestedIds = [...new Set(zoneIds.filter((id): id is string => !!id))];
  if (requestedIds.length === 0) return;

  const zones = await transaction.zone.findMany({
    where: { id: { in: requestedIds } },
    select: { id: true },
  });
  const existingIds = new Set(zones.map((zone) => zone.id));
  const missingId = requestedIds.find((id) => !existingIds.has(id));

  if (missingId) {
    throw new AppError(404, "ZONE_NOT_FOUND", `Zone '${missingId}' was not found.`);
  }
}

export async function createJob(
  input: CreateJobInput,
): Promise<{ job: JobWithZones; replayed: boolean }> {
  try {
    return await prisma.$transaction(async (transaction) => {
      if (input.idempotencyKey) {
        const existingByKey = await transaction.job.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: jobRelations,
        });

        if (existingByKey) {
          if (hasSameCreatePayload(existingByKey, input)) {
            return { job: existingByKey, replayed: true };
          }
          throw new AppError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "This idempotency key was already used with a different request.",
          );
        }
      }

      const existingOrder = await transaction.job.findUnique({
        where: { orderReference: input.orderReference },
        select: { id: true },
      });
      if (existingOrder) {
        throw new AppError(
          409,
          "ORDER_REFERENCE_EXISTS",
          "A job with this order reference already exists.",
        );
      }

      await assertZonesExist(transaction, [
        input.pickupZoneId,
        input.deliveryZoneId,
      ]);

      const job = await transaction.job.create({
        data: {
          orderReference: input.orderReference,
          ...(input.idempotencyKey
            ? { idempotencyKey: input.idempotencyKey }
            : {}),
          pickupZoneId: input.pickupZoneId,
          deliveryZoneId: input.deliveryZoneId,
          requiredCapacity: input.requiredCapacity,
          priority: input.priority ?? JobPriority.NORMAL,
          deadline: input.deadline ?? null,
        },
        include: jobRelations,
      });

      await transaction.jobEvent.create({
        data: {
          jobId: job.id,
          eventType: "JOB_CREATED",
          actor: "api",
          description: "Delivery job created.",
          details: {
            orderReference: job.orderReference,
            pickupZoneId: job.pickupZoneId,
            deliveryZoneId: job.deliveryZoneId,
            requiredCapacity: job.requiredCapacity,
            priority: job.priority,
            deadline: job.deadline?.toISOString() ?? null,
          },
        },
      });

      return { job, replayed: false };
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    if (input.idempotencyKey) {
      const existingByKey = await prisma.job.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: jobRelations,
      });
      if (existingByKey) {
        if (hasSameCreatePayload(existingByKey, input)) {
          return { job: existingByKey, replayed: true };
        }
        throw new AppError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This idempotency key was already used with a different request.",
        );
      }
    }

    const existingOrder = await prisma.job.findUnique({
      where: { orderReference: input.orderReference },
      select: { id: true },
    });
    if (existingOrder) {
      throw new AppError(
        409,
        "ORDER_REFERENCE_EXISTS",
        "A job with this order reference already exists.",
      );
    }

    throw error;
  }
}

export async function listJobs(query: ListJobsQuery) {
  const { page, pageSize, q, status, priority, pickupZoneId, deliveryZoneId } =
    query;
  const where: Prisma.JobWhereInput = {};

  if (q) where.orderReference = { contains: q, mode: "insensitive" };
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (pickupZoneId) where.pickupZoneId = pickupZoneId;
  if (deliveryZoneId) where.deliveryZoneId = deliveryZoneId;

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      include: jobRelations,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.job.count({ where }),
  ]);

  return {
    data: jobs,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getJobById(id: string) {
  const job = await prisma.job.findUnique({
    where: { id },
    include: jobDetailsRelations,
  });
  if (!job) throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");
  return job;
}

export async function updateJob(
  id: string,
  input: UpdateJobInput,
): Promise<JobWithZones> {
  return prisma.$transaction(async (transaction) => {
    const currentJob = await transaction.job.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!currentJob) {
      throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");
    }
    if (!editableStatuses.includes(currentJob.status)) {
      throw new AppError(
        409,
        "JOB_NOT_EDITABLE",
        `A job in ${currentJob.status} status cannot be edited.`,
      );
    }

    await assertZonesExist(transaction, [
      input.pickupZoneId,
      input.deliveryZoneId,
    ]);

    const result = await transaction.job.updateMany({
      where: { id, status: { in: editableStatuses } },
      data: input,
    });
    if (result.count !== 1) {
      throw new AppError(
        409,
        "JOB_CHANGED",
        "The job changed while this request was being processed. Retry the request.",
      );
    }

    const job = await transaction.job.findUniqueOrThrow({
      where: { id },
      include: jobRelations,
    });

    await transaction.jobEvent.create({
      data: {
        jobId: id,
        eventType: "JOB_UPDATED",
        actor: "api",
        description: "Editable delivery job details updated.",
        details: { changedFields: Object.keys(input) },
      },
    });

    return job;
  });
}
