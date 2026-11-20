import {
  AssignmentStatus,
  JobPriority,
  JobStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../utils/app-error.js";
import {
  dismissManualQueueJob,
  getManualQueueJob,
  listManualQueue,
  retryManualQueueJob,
} from "./manual-queue.service.js";
import {
  dismissManualQueueJobSchema,
  manualQueueListQuerySchema,
} from "./manual-queue.validation.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    job: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("../../config/database.js", () => ({ default: prismaMock }));

function createTransactionFixture(status: JobStatus = JobStatus.MANUAL_QUEUE) {
  const job = {
    id: "job-id",
    orderReference: "ORDER-123",
    pickupZoneId: "pickup-id",
    deliveryZoneId: "delivery-id",
    requiredCapacity: 2,
    priority: JobPriority.HIGH,
    status,
    deadline: null,
    createdAt: new Date("2026-11-18T12:00:00.000Z"),
    updatedAt: new Date("2026-11-19T10:00:00.000Z"),
    pickupZone: { id: "pickup-id", name: "Pickup" },
    deliveryZone: { id: "delivery-id", name: "Delivery" },
    assignments: [
      {
        id: "assignment-id",
        status: AssignmentStatus.REJECTED,
        rejectionReason: "Cannot take job",
        expiredAt: null,
        rejectedAt: new Date("2026-11-19T09:00:00.000Z"),
        assignedAt: new Date("2026-11-19T08:00:00.000Z"),
        rider: { id: "rider-id", name: "Rider One" },
      },
    ],
    events: [],
  };
  const eligibleRider = {
    id: "eligible-id",
    name: "Eligible",
    isAvailable: true,
    maxCapacity: 5,
    reservedCapacity: 1,
    zones: [
      { zone: { id: "pickup-id", name: "Pickup" } },
      { zone: { id: "delivery-id", name: "Delivery" } },
    ],
    assignments: [],
  };
  const unavailableRider = {
    ...eligibleRider,
    id: "unavailable-id",
    name: "Unavailable",
    isAvailable: false,
  };
  const events: unknown[] = [];
  const retryEvents = new Map<
    string,
    { id: string; details: Record<string, unknown> }
  >();
  let activeAssignment = false;

  const transaction = {
    $queryRaw: vi.fn(async () => [{ id: job.id }]),
    job: {
      findUnique: vi.fn(async () => ({ ...job, assignments: [...job.assignments] })),
      findUniqueOrThrow: vi.fn(async () => ({ ...job, assignments: [...job.assignments] })),
      updateMany: vi.fn(async ({ where, data }: {
        where: { status: JobStatus };
        data: { status: JobStatus };
      }) => {
        if (job.status !== where.status) return { count: 0 };
        Object.assign(job, data);
        return { count: 1 };
      }),
    },
    rider: {
      findMany: vi.fn(async () => [eligibleRider, unavailableRider]),
    },
    assignment: {
      findFirst: vi.fn(async () =>
        activeAssignment ? { id: "active-assignment" } : null,
      ),
    },
    jobEvent: {
      findFirst: vi.fn(async ({ where }: {
        where: { idempotencyKey: string };
      }) => retryEvents.get(where.idempotencyKey) ?? null),
      create: vi.fn(async ({ data }: {
        data: {
          idempotencyKey: string;
          details: Record<string, unknown>;
        };
      }) => {
        events.push(data);
        retryEvents.set(data.idempotencyKey, {
          id: "retry-event",
          details: data.details,
        });
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

  return {
    events,
    job,
    transaction,
    setActiveAssignment(value: boolean) {
      activeAssignment = value;
    },
  };
}

describe("manual queue service", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
    prismaMock.job.findMany.mockReset();
    prismaMock.job.count.mockReset();
  });

  it("filters only queued jobs, applies filters, and paginates in priority/age order", async () => {
    const queuedAt = new Date("2026-11-19T09:00:00.000Z");
    const jobs = [
      {
        id: "urgent-job",
        priority: JobPriority.URGENT,
        updatedAt: queuedAt,
        assignments: [{ id: "attempt-1" }],
      },
    ];
    prismaMock.job.findMany.mockResolvedValue(jobs);
    prismaMock.job.count.mockResolvedValue(3);

    const query = manualQueueListQuerySchema.parse({
      page: "2",
      pageSize: "1",
      priority: JobPriority.URGENT,
      pickupZoneId: "11111111-1111-4111-8111-111111111111",
      deliveryZoneId: "22222222-2222-4222-8222-222222222222",
      date: "2026-11-19",
      q: "order-",
    });
    const result = await listManualQueue(query);

    expect(prismaMock.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: JobStatus.MANUAL_QUEUE,
          priority: JobPriority.URGENT,
          pickupZoneId: "11111111-1111-4111-8111-111111111111",
          deliveryZoneId: "22222222-2222-4222-8222-222222222222",
          orderReference: { contains: "order-", mode: "insensitive" },
          createdAt: {
            gte: new Date("2026-11-19T00:00:00.000Z"),
            lt: new Date("2026-11-20T00:00:00.000Z"),
          },
        },
        orderBy: [
          { priority: "desc" },
          { updatedAt: "asc" },
          { id: "asc" },
        ],
        skip: 1,
        take: 1,
      }),
    );
    expect(result.data[0]).toMatchObject({
      assignmentAttemptCount: 1,
      previousAssignmentHistory: jobs[0].assignments,
      queuedAt,
    });
    expect(result.data[0]?.timeInQueueMs).toBeGreaterThanOrEqual(0);
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 1,
      total: 3,
      totalPages: 3,
    });
  });

  it("returns assignment history and eligible recommendations in job details", async () => {
    const fixture = createTransactionFixture();

    const result = await getManualQueueJob("job-id");

    expect(result.assignmentAttemptCount).toBe(1);
    expect(result.previousAssignmentHistory[0]).toMatchObject({
      rejectionReason: "Cannot take job",
    });
    expect(result.recommendations.map(({ riderId }) => riderId)).toEqual([
      "eligible-id",
    ]);
  });

  it("recalculates eligible riders without assigning or reserving capacity", async () => {
    const fixture = createTransactionFixture();

    const result = await retryManualQueueJob("job-id", "retry-key-1");

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]?.riderId).toBe("eligible-id");
    expect(result.recommendations[0]?.reasons).toContain(
      "Has sufficient remaining capacity",
    );
    expect(result.excludedRiders).toEqual([
      expect.objectContaining({
        riderId: "unavailable-id",
        reason: expect.stringContaining("unavailable"),
      }),
    ]);
    expect(fixture.transaction.rider.findMany).toHaveBeenCalled();
    expect(fixture.job.status).toBe(JobStatus.MANUAL_QUEUE);
    expect(fixture.transaction.job.updateMany).not.toHaveBeenCalled();
    expect(fixture.transaction.assignment.findFirst).not.toHaveBeenCalled();
    expect(fixture.transaction.jobEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "MANUAL_QUEUE_RETRY",
          details: expect.objectContaining({ idempotencyKey: "retry-key-1" }),
        }),
      }),
    );
  });

  it("does not append a duplicate retry audit event for a replayed key", async () => {
    const fixture = createTransactionFixture();

    const first = await retryManualQueueJob("job-id", "retry-key-1");
    const replay = await retryManualQueueJob("job-id", "retry-key-1");

    expect(fixture.transaction.jobEvent.create).toHaveBeenCalledTimes(1);
    expect(fixture.transaction.rider.findMany).toHaveBeenCalledTimes(1);
    expect(replay).toEqual(first);
  });

  it("serializes concurrent retries and returns the original response", async () => {
    const fixture = createTransactionFixture();

    const results = await Promise.all([
      retryManualQueueJob("job-id", "retry-key-concurrent"),
      retryManualQueueJob("job-id", "retry-key-concurrent"),
    ]);

    expect(results[1]).toEqual(results[0]);
    expect(fixture.transaction.jobEvent.create).toHaveBeenCalledTimes(1);
    expect(fixture.transaction.rider.findMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    JobStatus.CANCELLED,
    JobStatus.PICKED_UP,
    JobStatus.DELIVERED,
    JobStatus.ACCEPTED,
  ])("rejects retry when job status is %s", async (status) => {
    createTransactionFixture(status);

    await expect(
      retryManualQueueJob("job-id", "retry-key-1"),
    ).rejects.toMatchObject({ code: "JOB_NOT_IN_MANUAL_QUEUE" });
  });

  it("dismisses a queued job, preserves history, and records the reason", async () => {
    const fixture = createTransactionFixture();

    const result = await dismissManualQueueJob(
      "job-id",
      "Customer requested cancellation",
    );

    expect(result.status).toBe(JobStatus.CANCELLED);
    expect(fixture.job.assignments).toHaveLength(1);
    expect(fixture.events).toEqual([
      expect.objectContaining({
        eventType: "MANUAL_QUEUE_DISMISSED",
        details: expect.objectContaining({
          reason: "Customer requested cancellation",
        }),
      }),
    ]);
  });

  it("does not dismiss a queue entry with an active assignment", async () => {
    const fixture = createTransactionFixture();
    fixture.setActiveAssignment(true);

    await expect(
      dismissManualQueueJob("job-id", "No longer needed"),
    ).rejects.toMatchObject({ code: "JOB_HAS_ACTIVE_ASSIGNMENT" });
    expect(fixture.job.status).toBe(JobStatus.MANUAL_QUEUE);
    expect(fixture.events).toHaveLength(0);
  });

  it("allows only one concurrent dismissal to succeed", async () => {
    const fixture = createTransactionFixture();

    const outcomes = await Promise.allSettled([
      dismissManualQueueJob("job-id", "Reason one"),
      dismissManualQueueJob("job-id", "Reason two"),
    ]);

    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      reason: expect.any(AppError),
    });
    expect(fixture.events).toHaveLength(1);
  });

  it("validates queue filters and dismissal reasons", () => {
    expect(
      manualQueueListQuerySchema.safeParse({ date: "not-a-date" }).success,
    ).toBe(false);
    expect(dismissManualQueueJobSchema.safeParse({ reason: "  " }).success).toBe(
      false,
    );
    expect(
      dismissManualQueueJobSchema.safeParse({ reason: "Duplicate order" })
        .success,
    ).toBe(true);
  });
});
