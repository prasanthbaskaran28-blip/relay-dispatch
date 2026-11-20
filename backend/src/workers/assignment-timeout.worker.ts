import {
  AssignmentStatus,
  JobStatus,
  Prisma,
} from "@prisma/client";
import prisma from "../config/database.js";

const batchSize = 100;
const workerActor = "assignment-timeout-worker";
const activeAssignmentStatuses = [
  AssignmentStatus.PENDING,
  AssignmentStatus.ACCEPTED,
];

type Transaction = Prisma.TransactionClient;

async function lockJob(
  transaction: Transaction,
  jobId: string,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Job" WHERE "id" = ${jobId} FOR UPDATE
  `;
  return rows.length > 0;
}

async function lockAssignment(
  transaction: Transaction,
  assignmentId: string,
  jobId: string,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Assignment"
    WHERE "id" = ${assignmentId} AND "jobId" = ${jobId}
    FOR UPDATE
  `;
  return rows.length > 0;
}

async function lockRider(
  transaction: Transaction,
  riderId: string,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Rider" WHERE "id" = ${riderId} FOR UPDATE
  `;
  return rows.length > 0;
}

async function expireAssignment(
  assignmentId: string,
  now: Date,
): Promise<"expired" | "skipped"> {
  return prisma.$transaction(
    async (transaction) => {
      const locator = await transaction.assignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, jobId: true },
      });
      if (!locator || !(await lockJob(transaction, locator.jobId))) {
        return "skipped";
      }
      if (!(await lockAssignment(transaction, assignmentId, locator.jobId))) {
        return "skipped";
      }

      const assignment = await transaction.assignment.findUnique({
        where: { id: assignmentId },
        select: {
          id: true,
          jobId: true,
          riderId: true,
          status: true,
          confirmationDeadline: true,
          capacityReserved: true,
        },
      });
      if (
        !assignment ||
        assignment.status !== AssignmentStatus.PENDING ||
        assignment.confirmationDeadline > now ||
        !assignment.capacityReserved
      ) {
        return "skipped";
      }

      const job = await transaction.job.findUnique({
        where: { id: assignment.jobId },
        select: { id: true, status: true, requiredCapacity: true },
      });
      if (!job) {
        return "skipped";
      }

      const validReplacement = await transaction.assignment.findFirst({
        where: {
          reassignedFromId: assignment.id,
          status: { in: activeAssignmentStatuses },
          capacityReserved: true,
          OR: [
            { status: AssignmentStatus.ACCEPTED },
            {
              status: AssignmentStatus.PENDING,
              confirmationDeadline: { gt: now },
            },
          ],
        },
        select: { id: true },
      });
      if (validReplacement) {
        return "skipped";
      }

      if (!(await lockRider(transaction, assignment.riderId))) {
        return "skipped";
      }

      const update = await transaction.assignment.updateMany({
        where: {
          id: assignment.id,
          jobId: assignment.jobId,
          status: AssignmentStatus.PENDING,
          confirmationDeadline: { lte: now },
          capacityReserved: true,
        },
        data: {
          status: AssignmentStatus.EXPIRED,
          expiredAt: now,
          capacityReserved: false,
        },
      });
      if (update.count !== 1) {
        return "skipped";
      }

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
        throw new Error(
          `Could not release reserved capacity for assignment ${assignment.id}.`,
        );
      }

      const otherValidAssignment = await transaction.assignment.findFirst({
        where: {
          jobId: job.id,
          id: { not: assignment.id },
          status: { in: activeAssignmentStatuses },
          capacityReserved: true,
          OR: [
            { status: AssignmentStatus.ACCEPTED },
            {
              status: AssignmentStatus.PENDING,
              confirmationDeadline: { gt: now },
            },
          ],
        },
        select: { id: true },
      });
      if (
        !otherValidAssignment &&
        job.status === JobStatus.AWAITING_CONFIRMATION
      ) {
        await transaction.job.updateMany({
          where: {
            id: job.id,
            status: JobStatus.AWAITING_CONFIRMATION,
          },
          data: { status: JobStatus.MANUAL_QUEUE },
        });
      }

      await transaction.jobEvent.create({
        data: {
          jobId: job.id,
          eventType: "ASSIGNMENT_EXPIRED",
          actor: workerActor,
          description:
            "The rider did not confirm the assignment before its deadline.",
          details: {
            assignmentId: assignment.id,
            riderId: assignment.riderId,
            jobId: job.id,
            expiredAt: now.toISOString(),
            requiredCapacity: job.requiredCapacity,
            capacityReleased: true,
          },
        },
      });

      return "expired";
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function processExpiredAssignments(
  now = new Date(),
): Promise<void> {
  const assignments = await prisma.assignment.findMany({
    where: {
      status: AssignmentStatus.PENDING,
      confirmationDeadline: { lte: now },
      capacityReserved: true,
    },
    orderBy: [{ confirmationDeadline: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { id: true },
  });

  let processed = 0;
  let expired = 0;
  let skipped = 0;
  let failed = 0;

  for (const { id } of assignments) {
    try {
      const result = await expireAssignment(id, now);
      processed += 1;
      if (result === "expired") {
        expired += 1;
        console.info("Assignment timeout expired assignment", {
          assignmentId: id,
        });
      } else {
        skipped += 1;
        console.info("Assignment timeout skipped assignment", {
          assignmentId: id,
        });
      }
    } catch (error) {
      failed += 1;
      console.error("Assignment timeout failed for assignment", {
        assignmentId: id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  console.info("Assignment timeout batch processed", {
    processed,
    expired,
    skipped,
    failed,
  });
}

function getIntervalMilliseconds(): number {
  const configuredInterval = process.env.TIMEOUT_CHECK_INTERVAL_SECONDS;
  const intervalSeconds = Number(configuredInterval ?? 30);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error(
      "TIMEOUT_CHECK_INTERVAL_SECONDS must be a positive number of seconds.",
    );
  }
  return intervalSeconds * 1000;
}

export function startAssignmentTimeoutWorker(): () => Promise<void> {
  const intervalMilliseconds = getIntervalMilliseconds();
  let running: Promise<void> | null = null;
  let stopped = false;

  const run = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = processExpiredAssignments()
      .catch((error: unknown) => {
        console.error("Assignment timeout worker run failed", error);
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  void run();
  const interval = setInterval(() => {
    void run();
  }, intervalMilliseconds);

  return async () => {
    stopped = true;
    clearInterval(interval);
    await running;
  };
}
