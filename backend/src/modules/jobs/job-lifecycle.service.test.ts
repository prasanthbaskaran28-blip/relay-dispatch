import {
  AssignmentStatus,
  JobStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../utils/app-error.js";
import {
  cancelJob,
  deliverJob,
  getJobTimeline,
  pickUpJob,
} from "./job-lifecycle.service.js";
import { cancelJobSchema } from "./job-lifecycle.validation.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    job: { findUnique: vi.fn() },
    jobEvent: { findMany: vi.fn() },
  },
}));

vi.mock("../../config/database.js", () => ({ default: prismaMock }));

function createFixture(
  status: JobStatus = JobStatus.ACCEPTED,
  assignmentStatus: AssignmentStatus = AssignmentStatus.ACCEPTED,
) {
  const job = {
    id: "job-id",
    orderReference: "ORDER-123",
    status,
    requiredCapacity: 2,
    assignments: [] as Array<Record<string, unknown>>,
  };
  const assignment = {
    id: "assignment-id",
    jobId: job.id,
    riderId: "rider-id",
    status: assignmentStatus,
    capacityReserved: true,
  };
  job.assignments.push(assignment);
  const rider = { id: "rider-id", reservedCapacity: 4 };
  const events: Array<{ data: Record<string, unknown> }> = [];
  const timeline = [
    { id: "created", eventType: "JOB_CREATED", createdAt: new Date(1) },
    { id: "accepted", eventType: "ASSIGNMENT_ACCEPTED", createdAt: new Date(2) },
  ];

  const transaction = {
    $queryRaw: vi.fn(async () => [{ id: "locked" }]),
    job: {
      findUnique: vi.fn(async () => ({
        id: job.id,
        orderReference: job.orderReference,
        status: job.status,
        requiredCapacity: job.requiredCapacity,
      })),
      findUniqueOrThrow: vi.fn(async () => ({ ...job })),
      updateMany: vi.fn(async ({ where, data }: {
        where: { status: JobStatus };
        data: { status: JobStatus };
      }) => {
        if (job.status !== where.status) return { count: 0 };
        job.status = data.status;
        return { count: 1 };
      }),
    },
    assignment: {
      findMany: vi.fn(async ({ where }: {
        where: {
          jobId: string;
          status: AssignmentStatus | { in: AssignmentStatus[] };
          capacityReserved?: boolean;
        };
      }) => job.assignments.filter((record) => {
        const statusMatches =
          typeof where.status === "string"
            ? record.status === where.status
            : where.status.in.includes(record.status as AssignmentStatus);
        return record.jobId === where.jobId &&
          statusMatches &&
          (where.capacityReserved === undefined ||
            record.capacityReserved === where.capacityReserved);
      })),
      updateMany: vi.fn(async ({ where, data }: {
        where: {
          id: string;
          status: AssignmentStatus;
          capacityReserved: boolean;
        };
        data: {
          status: AssignmentStatus;
          capacityReserved: boolean;
        };
      }) => {
        const record = job.assignments.find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.status === where.status &&
            candidate.capacityReserved === where.capacityReserved,
        );
        if (!record) return { count: 0 };
        Object.assign(record, data);
        return { count: 1 };
      }),
    },
    rider: {
      updateMany: vi.fn(async ({ where, data }: {
        where: { id: string; reservedCapacity: { gte: number } };
        data: { reservedCapacity: { decrement: number } };
      }) => {
        const amount = data.reservedCapacity.decrement;
        if (
          rider.id !== where.id ||
          rider.reservedCapacity < where.reservedCapacity.gte ||
          rider.reservedCapacity < amount
        ) {
          return { count: 0 };
        }
        rider.reservedCapacity -= amount;
        return { count: 1 };
      }),
    },
    jobEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push({ data });
        return data;
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
  prismaMock.job.findUnique.mockResolvedValue({
    id: job.id,
    orderReference: job.orderReference,
  });
  prismaMock.jobEvent.findMany.mockResolvedValue(timeline);

  return { assignment, events, job, rider, timeline, transaction };
}

describe("job lifecycle service", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
    prismaMock.job.findUnique.mockReset();
    prismaMock.jobEvent.findMany.mockReset();
  });

  it("picks up an accepted job with an accepted reserved assignment", async () => {
    const fixture = createFixture();

    const result = await pickUpJob("job-id");

    expect(result.status).toBe(JobStatus.PICKED_UP);
    expect(fixture.events[0]?.data).toMatchObject({
      eventType: "JOB_PICKED_UP",
      details: expect.objectContaining({
        assignmentId: "assignment-id",
        pickedUpAt: expect.any(String),
      }),
    });
  });

  it("does not allow pickup without an accepted assignment", async () => {
    const fixture = createFixture(
      JobStatus.ACCEPTED,
      AssignmentStatus.REJECTED,
    );

    await expect(pickUpJob("job-id")).rejects.toMatchObject({
      code: "ACTIVE_ASSIGNMENT_REQUIRED",
    });
    expect(fixture.job.status).toBe(JobStatus.ACCEPTED);
    expect(fixture.events).toHaveLength(0);
  });

  it("delivers a picked-up job and releases its reservation once", async () => {
    const fixture = createFixture(
      JobStatus.PICKED_UP,
      AssignmentStatus.ACCEPTED,
    );

    const result = await deliverJob("job-id");

    expect(result.status).toBe(JobStatus.DELIVERED);
    expect(fixture.assignment).toMatchObject({
      status: AssignmentStatus.COMPLETED,
      capacityReserved: false,
    });
    expect(fixture.rider.reservedCapacity).toBe(2);
    expect(fixture.events[0]?.data).toMatchObject({
      eventType: "JOB_DELIVERED",
      details: expect.objectContaining({
        deliveredAt: expect.any(String),
      }),
    });
    await expect(deliverJob("job-id")).rejects.toMatchObject({
      code: "JOB_NOT_PICKED_UP",
    });
    expect(fixture.rider.reservedCapacity).toBe(2);
    expect(fixture.events).toHaveLength(1);
  });

  it("cancels a job, closes the pending assignment, and releases capacity", async () => {
    const fixture = createFixture(
      JobStatus.AWAITING_CONFIRMATION,
      AssignmentStatus.PENDING,
    );

    const result = await cancelJob("job-id", "Customer cancelled");

    expect(result.status).toBe(JobStatus.CANCELLED);
    expect(fixture.assignment).toMatchObject({
      status: AssignmentStatus.CANCELLED,
      capacityReserved: false,
    });
    expect(fixture.rider.reservedCapacity).toBe(2);
    expect(fixture.events[0]?.data).toMatchObject({
      eventType: "JOB_CANCELLED",
      details: expect.objectContaining({ reason: "Customer cancelled" }),
    });
  });

  it("does not allow delivery before pickup or cancellation after pickup", async () => {
    const notPickedUp = createFixture(JobStatus.ACCEPTED);
    await expect(deliverJob("job-id")).rejects.toMatchObject({
      code: "JOB_NOT_PICKED_UP",
    });

    const alreadyPickedUp = createFixture(
      JobStatus.PICKED_UP,
      AssignmentStatus.ACCEPTED,
    );
    await expect(
      cancelJob("job-id", "Customer cancelled"),
    ).rejects.toMatchObject({ code: "JOB_NOT_CANCELLABLE" });
    expect(notPickedUp.rider.reservedCapacity).toBe(4);
    expect(alreadyPickedUp.rider.reservedCapacity).toBe(4);
  });

  it("prevents duplicate and concurrent pickup requests", async () => {
    const fixture = createFixture();

    const results = await Promise.allSettled([
      pickUpJob("job-id"),
      pickUpJob("job-id"),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({
      reason: expect.any(AppError),
    });
    expect(fixture.job.status).toBe(JobStatus.PICKED_UP);
    expect(fixture.events).toHaveLength(1);
  });

  it("requires a non-empty cancellation reason", () => {
    expect(cancelJobSchema.safeParse({ reason: " " }).success).toBe(false);
    expect(cancelJobSchema.safeParse({ reason: "Duplicate order" }).success).toBe(
      true,
    );
  });

  it("returns all lifecycle events in chronological order", async () => {
    const fixture = createFixture();

    const result = await getJobTimeline("job-id");

    expect(result.events).toEqual(fixture.timeline);
    expect(prismaMock.jobEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: "job-id" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
  });
});
