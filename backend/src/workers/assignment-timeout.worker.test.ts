import { AssignmentStatus, JobStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  processExpiredAssignments,
  startAssignmentTimeoutWorker,
} from "./assignment-timeout.worker.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    assignment: { findMany: vi.fn() },
  },
}));

vi.mock("../config/database.js", () => ({ default: prismaMock }));

const now = new Date("2026-11-19T10:00:00.000Z");

function createFixture() {
  const assignment = {
    id: "assignment-id",
    jobId: "job-id",
    riderId: "rider-id",
    status: AssignmentStatus.PENDING as AssignmentStatus,
    confirmationDeadline: new Date(now.getTime() - 1),
    capacityReserved: true,
    expiredAt: null as Date | null,
  };
  const job = {
    id: "job-id",
    status: JobStatus.AWAITING_CONFIRMATION as JobStatus,
    requiredCapacity: 2,
  };
  const rider = { reservedCapacity: 4 };
  const events: Array<{ data: Record<string, unknown> }> = [];
  let hasReplacement = false;
  let hasOtherValidAssignment = false;

  const transaction = {
    $queryRaw: vi.fn(async () => [{ id: "locked" }]),
    assignment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === "broken-assignment") {
          throw new Error("Simulated assignment read failure.");
        }
        return { ...assignment };
      }),
      findFirst: vi.fn(async (query: { where: Record<string, unknown> }) => {
        if ("reassignedFromId" in query.where) {
          return hasReplacement ? { id: "replacement-id" } : null;
        }
        return hasOtherValidAssignment ? { id: "other-id" } : null;
      }),
      updateMany: vi.fn(
        async (query: {
          where: {
            status: AssignmentStatus;
            capacityReserved: boolean;
            confirmationDeadline: { lte: Date };
          };
          data: Partial<typeof assignment>;
        }) => {
          if (
            assignment.status !== query.where.status ||
            assignment.capacityReserved !== query.where.capacityReserved ||
            assignment.confirmationDeadline > query.where.confirmationDeadline.lte
          ) {
            return { count: 0 };
          }
          Object.assign(assignment, query.data);
          return { count: 1 };
        },
      ),
    },
    job: {
      findUnique: vi.fn(async () => ({ ...job })),
      updateMany: vi.fn(
        async (query: {
          where: { status: JobStatus };
          data: { status: JobStatus };
        }) => {
          if (job.status !== query.where.status) return { count: 0 };
          job.status = query.data.status;
          return { count: 1 };
        },
      ),
    },
    rider: {
      updateMany: vi.fn(
        async (query: {
          where: { reservedCapacity: { gte: number } };
          data: { reservedCapacity: { decrement: number } };
        }) => {
          const amount = query.data.reservedCapacity.decrement;
          if (rider.reservedCapacity < query.where.reservedCapacity.gte) {
            return { count: 0 };
          }
          rider.reservedCapacity -= amount;
          return { count: 1 };
        },
      ),
    },
    jobEvent: {
      create: vi.fn(async (event: { data: Record<string, unknown> }) => {
        events.push(event);
        return event;
      }),
    },
  };

  let transactionTail = Promise.resolve();
  prismaMock.$transaction.mockImplementation(
    async (callback: (tx: typeof transaction) => Promise<unknown>) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback(transaction);
      } finally {
        release();
      }
    },
  );
  prismaMock.assignment.findMany.mockResolvedValue([{ id: assignment.id }]);

  return {
    assignment,
    events,
    job,
    rider,
    transaction,
    setHasReplacement(value: boolean) {
      hasReplacement = value;
    },
    setHasOtherValidAssignment(value: boolean) {
      hasOtherValidAssignment = value;
    },
  };
}

describe("assignment timeout worker", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
    prismaMock.assignment.findMany.mockReset();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("expires a past-deadline assignment, releases capacity, and queues its job", async () => {
    const fixture = createFixture();

    await processExpiredAssignments(now);

    expect(fixture.assignment.status).toBe(AssignmentStatus.EXPIRED);
    expect(fixture.assignment.expiredAt).toEqual(now);
    expect(fixture.assignment.capacityReserved).toBe(false);
    expect(fixture.rider.reservedCapacity).toBe(2);
    expect(fixture.job.status).toBe(JobStatus.MANUAL_QUEUE);
    expect(fixture.events[0].data).toEqual(
      expect.objectContaining({
        eventType: "ASSIGNMENT_EXPIRED",
        details: {
          assignmentId: "assignment-id",
          riderId: "rider-id",
          jobId: "job-id",
          expiredAt: now.toISOString(),
          requiredCapacity: 2,
          capacityReleased: true,
        },
      }),
    );
  });

  it("does not expire terminal assignments or assignments with released capacity", async () => {
    for (const status of [
      AssignmentStatus.ACCEPTED,
      AssignmentStatus.REJECTED,
      AssignmentStatus.EXPIRED,
      AssignmentStatus.REASSIGNED,
    ]) {
      const fixture = createFixture();
      fixture.assignment.status = status;
      await processExpiredAssignments(now);
      expect(fixture.assignment.status).toBe(status);
      expect(fixture.rider.reservedCapacity).toBe(4);
      expect(fixture.events).toHaveLength(0);
    }

    const released = createFixture();
    released.assignment.capacityReserved = false;
    await processExpiredAssignments(now);
    expect(released.assignment.status).toBe(AssignmentStatus.PENDING);
    expect(released.rider.reservedCapacity).toBe(4);
    expect(released.events).toHaveLength(0);
  });

  it("does not expire an assignment that already has an active replacement", async () => {
    const fixture = createFixture();
    fixture.setHasReplacement(true);

    await processExpiredAssignments(now);

    expect(fixture.assignment.status).toBe(AssignmentStatus.PENDING);
    expect(fixture.rider.reservedCapacity).toBe(4);
    expect(fixture.events).toHaveLength(0);
  });

  it("does not overwrite a cancelled or picked-up job status", async () => {
    for (const status of [JobStatus.CANCELLED, JobStatus.PICKED_UP]) {
      const fixture = createFixture();
      fixture.job.status = status;

      await processExpiredAssignments(now);

      expect(fixture.assignment.status).toBe(AssignmentStatus.EXPIRED);
      expect(fixture.job.status).toBe(status);
    }
  });

  it("keeps the job out of the manual queue when another valid assignment exists", async () => {
    const fixture = createFixture();
    fixture.setHasOtherValidAssignment(true);

    await processExpiredAssignments(now);

    expect(fixture.assignment.status).toBe(AssignmentStatus.EXPIRED);
    expect(fixture.job.status).toBe(JobStatus.AWAITING_CONFIRMATION);
  });

  it("releases capacity and creates an audit event only once under concurrent runs", async () => {
    const fixture = createFixture();

    await Promise.all([
      processExpiredAssignments(now),
      processExpiredAssignments(now),
    ]);

    expect(fixture.assignment.status).toBe(AssignmentStatus.EXPIRED);
    expect(fixture.rider.reservedCapacity).toBe(2);
    expect(fixture.transaction.rider.updateMany).toHaveBeenCalledTimes(1);
    expect(fixture.events).toHaveLength(1);
  });

  it("continues processing the batch after an individual assignment failure", async () => {
    const fixture = createFixture();
    prismaMock.assignment.findMany.mockResolvedValue([
      { id: "broken-assignment" },
      { id: "assignment-id" },
    ]);

    await processExpiredAssignments(now);

    expect(fixture.assignment.status).toBe(AssignmentStatus.EXPIRED);
    expect(fixture.events).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(
      "Assignment timeout failed for assignment",
      expect.objectContaining({ assignmentId: "broken-assignment" }),
    );
  });

  it("does not overlap scheduled runs and waits for an in-flight run on stop", async () => {
    vi.useFakeTimers();
    const oldInterval = process.env.TIMEOUT_CHECK_INTERVAL_SECONDS;
    process.env.TIMEOUT_CHECK_INTERVAL_SECONDS = "30";
    let finishQuery!: (assignments: Array<{ id: string }>) => void;
    prismaMock.assignment.findMany.mockReturnValue(
      new Promise((resolve) => {
        finishQuery = resolve;
      }),
    );

    try {
      const stop = startAssignmentTimeoutWorker();
      expect(prismaMock.assignment.findMany).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(prismaMock.assignment.findMany).toHaveBeenCalledTimes(1);

      finishQuery([]);
      await stop();
    } finally {
      if (oldInterval === undefined) {
        delete process.env.TIMEOUT_CHECK_INTERVAL_SECONDS;
      } else {
        process.env.TIMEOUT_CHECK_INTERVAL_SECONDS = oldInterval;
      }
      vi.useRealTimers();
    }
  });
});
