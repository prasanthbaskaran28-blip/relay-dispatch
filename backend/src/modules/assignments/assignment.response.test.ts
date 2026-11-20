import { AssignmentStatus, JobStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../utils/app-error.js";
import { acceptAssignment, rejectAssignment } from "./assignment.service.js";
import { rejectAssignmentSchema } from "./assignment.validation.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { $transaction: vi.fn() },
}));

vi.mock("../../config/database.js", () => ({ default: prismaMock }));

function createFixture() {
  const assignment = {
    id: "assignment-id",
    jobId: "job-id",
    riderId: "rider-id",
    status: AssignmentStatus.PENDING as AssignmentStatus,
    confirmationDeadline: new Date(Date.now() + 60_000),
    capacityReserved: true,
    confirmedAt: null as Date | null,
    rejectedAt: null as Date | null,
    rejectionReason: null as string | null,
  };
  const job = {
    id: "job-id",
    status: JobStatus.AWAITING_CONFIRMATION as JobStatus,
    requiredCapacity: 2,
  };
  const rider = { reservedCapacity: 4 };
  const events: unknown[] = [];
  let hasOtherValidAssignment = false;
  let hasReplacement = false;
  let assignmentUpdateCount: number | undefined;

  const transaction = {
    $queryRaw: vi.fn(async () => [{ id: "locked" }]),
    assignment: {
      findUnique: vi.fn(async () => ({ ...assignment })),
      findUniqueOrThrow: vi.fn(async () => ({ ...assignment })),
      findFirst: vi.fn(async (query: { where: Record<string, unknown> }) => {
        if ("reassignedFromId" in query.where) {
          return hasReplacement ? { id: "replacement-assignment" } : null;
        }
        return hasOtherValidAssignment ? { id: "other-assignment" } : null;
      }),
      updateMany: vi.fn(
        async (query: {
          where: { status: AssignmentStatus; capacityReserved: boolean };
          data: Record<string, unknown>;
        }) => {
          if (assignmentUpdateCount !== undefined) {
            return { count: assignmentUpdateCount };
          }
          if (
            assignment.status !== query.where.status ||
            assignment.capacityReserved !== query.where.capacityReserved
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
      updateMany: vi.fn(async (query: { data: { reservedCapacity: { decrement: number } } }) => {
        const amount = query.data.reservedCapacity.decrement;
        if (rider.reservedCapacity < amount) return { count: 0 };
        rider.reservedCapacity -= amount;
        return { count: 1 };
      }),
    },
    jobEvent: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        events.push(data);
        return data;
      }),
    },
  };

  let transactionTail = Promise.resolve();
  prismaMock.$transaction.mockImplementation(
    async (
      callback: (tx: typeof transaction) => Promise<unknown>,
      options: { isolationLevel?: string },
    ) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        expect(options.isolationLevel).toBe("Serializable");
        return await callback(transaction);
      } finally {
        release();
      }
    },
  );

  return {
    assignment,
    events,
    job,
    rider,
    setHasOtherValidAssignment(value: boolean) {
      hasOtherValidAssignment = value;
    },
    setHasReplacement(value: boolean) {
      hasReplacement = value;
    },
    setAssignmentUpdateCount(value: number) {
      assignmentUpdateCount = value;
    },
  };
}

describe("assignment responses", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
  });

  it("accepts a pending assignment without releasing its reservation", async () => {
    const fixture = createFixture();

    const result = await acceptAssignment("assignment-id");

    expect(result.status).toBe(AssignmentStatus.ACCEPTED);
    expect(fixture.assignment.confirmedAt).toBeInstanceOf(Date);
    expect(fixture.assignment.capacityReserved).toBe(true);
    expect(fixture.rider.reservedCapacity).toBe(4);
    expect(fixture.job.status).toBe(JobStatus.ACCEPTED);
    expect(fixture.events).toEqual([
      expect.objectContaining({ eventType: "ASSIGNMENT_ACCEPTED" }),
    ]);
  });

  it("rejects a pending assignment, releases its capacity, and queues the job", async () => {
    const fixture = createFixture();

    const result = await rejectAssignment(
      "assignment-id",
      "Cannot take this job",
    );

    expect(result.status).toBe(AssignmentStatus.REJECTED);
    expect(fixture.assignment.rejectionReason).toBe("Cannot take this job");
    expect(fixture.assignment.rejectedAt).toBeInstanceOf(Date);
    expect(fixture.assignment.capacityReserved).toBe(false);
    expect(fixture.rider.reservedCapacity).toBe(2);
    expect(fixture.job.status).toBe(JobStatus.MANUAL_QUEUE);
    expect(fixture.events).toEqual([
      expect.objectContaining({
        eventType: "ASSIGNMENT_REJECTED",
        details: expect.objectContaining({
          rejectionReason: "Cannot take this job",
        }),
      }),
    ]);
  });

  it("requires a non-empty rejection reason", () => {
    expect(rejectAssignmentSchema.safeParse({ rejectionReason: "  " }).success)
      .toBe(false);
    expect(
      rejectAssignmentSchema.safeParse({
        rejectionReason: "Schedule conflict",
      }).success,
    ).toBe(true);
  });

  it("rejects responses to non-pending assignments", async () => {
    const fixture = createFixture();
    fixture.assignment.status = AssignmentStatus.REASSIGNED;

    await expect(acceptAssignment("assignment-id")).rejects.toMatchObject({
      code: "ASSIGNMENT_NOT_PENDING",
    });
  });

  it("does not accept an assignment that has been replaced", async () => {
    const fixture = createFixture();
    fixture.setHasReplacement(true);

    await expect(acceptAssignment("assignment-id")).rejects.toMatchObject({
      code: "ASSIGNMENT_NOT_CURRENT",
    });
  });

  it("does not release capacity when a concurrent response wins the conditional update", async () => {
    const fixture = createFixture();
    fixture.setAssignmentUpdateCount(0);

    await expect(
      rejectAssignment("assignment-id", "Cannot take this job"),
    ).rejects.toMatchObject({ code: "ASSIGNMENT_CHANGED" });

    expect(fixture.assignment.status).toBe(AssignmentStatus.PENDING);
    expect(fixture.rider.reservedCapacity).toBe(4);
    expect(fixture.events).toHaveLength(0);
  });

  it("does not reduce reserved capacity below the job's reserved amount", async () => {
    const fixture = createFixture();
    fixture.rider.reservedCapacity = 1;

    await expect(
      rejectAssignment("assignment-id", "Cannot take this job"),
    ).rejects.toMatchObject({ code: "CAPACITY_RESERVATION_MISMATCH" });

    expect(fixture.rider.reservedCapacity).toBe(1);
    expect(fixture.events).toHaveLength(0);
  });

  it("rejects acceptance after the confirmation deadline", async () => {
    const fixture = createFixture();
    fixture.assignment.confirmationDeadline = new Date(Date.now() - 1);

    await expect(acceptAssignment("assignment-id")).rejects.toMatchObject({
      code: "ASSIGNMENT_EXPIRED",
    });
  });

  it("does not change the job lifecycle when another valid assignment exists", async () => {
    const fixture = createFixture();
    fixture.setHasOtherValidAssignment(true);

    await rejectAssignment("assignment-id", "Cannot take this job");

    expect(fixture.job.status).toBe(JobStatus.AWAITING_CONFIRMATION);
  });

  it("prevents concurrent duplicate responses from succeeding twice", async () => {
    const fixture = createFixture();

    const results = await Promise.allSettled([
      acceptAssignment("assignment-id"),
      acceptAssignment("assignment-id"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: expect.any(AppError),
    });
    expect(fixture.events).toHaveLength(1);
    expect(fixture.assignment.status).toBe(AssignmentStatus.ACCEPTED);
  });

  it("rejects a duplicate request after the assignment has already been accepted", async () => {
    createFixture();
    await acceptAssignment("assignment-id");

    await expect(acceptAssignment("assignment-id")).rejects.toMatchObject({
      code: "ASSIGNMENT_NOT_PENDING",
    });
  });

  it("does not release capacity twice for duplicate rejection requests", async () => {
    const fixture = createFixture();
    await rejectAssignment("assignment-id", "Cannot take this job");

    await expect(
      rejectAssignment("assignment-id", "Cannot take this job"),
    ).rejects.toMatchObject({ code: "ASSIGNMENT_NOT_PENDING" });

    expect(fixture.rider.reservedCapacity).toBe(2);
    expect(fixture.events).toHaveLength(1);
  });
});
