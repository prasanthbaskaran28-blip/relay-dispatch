import {
  AssignmentStatus,
  JobStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDashboardOverview,
  getDashboardTrends,
  getZonePerformance,
} from "./dashboard.service.js";
import { dashboardTrendsQuerySchema } from "./dashboard.validation.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    job: { groupBy: vi.fn() },
    rider: { groupBy: vi.fn() },
    assignment: { groupBy: vi.fn() },
    jobEvent: { findMany: vi.fn() },
  },
}));

vi.mock("../../config/database.js", () => ({ default: prismaMock }));

function prepareEmptyOverview() {
  prismaMock.job.groupBy.mockResolvedValue([]);
  prismaMock.rider.groupBy.mockResolvedValue([]);
  prismaMock.assignment.groupBy.mockResolvedValue([]);
  prismaMock.$queryRaw.mockResolvedValue([
    {
      ridersWithActiveAssignments: 0,
      averageAssignmentConfirmationTimeMs: null,
      averageDeliveryTimeMs: null,
      jobsApproachingDeadline: 0,
      overdueActiveJobs: 0,
    },
  ]);
  prismaMock.jobEvent.findMany.mockResolvedValue([]);
}

describe("dashboard analytics", () => {
  beforeEach(() => {
    prismaMock.$queryRaw.mockReset();
    prismaMock.job.groupBy.mockReset();
    prismaMock.rider.groupBy.mockReset();
    prismaMock.assignment.groupBy.mockReset();
    prismaMock.jobEvent.findMany.mockReset();
  });

  it("calculates overview metrics from grouped counts and database aggregates", async () => {
    prismaMock.job.groupBy.mockResolvedValue([
      { status: JobStatus.NEW, _count: { _all: 3 } },
      { status: JobStatus.AWAITING_CONFIRMATION, _count: { _all: 1 } },
      { status: JobStatus.ACCEPTED, _count: { _all: 1 } },
      { status: JobStatus.PICKED_UP, _count: { _all: 1 } },
      { status: JobStatus.DELIVERED, _count: { _all: 2 } },
      { status: JobStatus.CANCELLED, _count: { _all: 1 } },
    ]);
    prismaMock.rider.groupBy.mockResolvedValue([
      { isAvailable: true, _count: { _all: 3 } },
      { isAvailable: false, _count: { _all: 2 } },
    ]);
    prismaMock.assignment.groupBy.mockResolvedValue([
      { status: AssignmentStatus.PENDING, _count: { _all: 2 } },
      { status: AssignmentStatus.ACCEPTED, _count: { _all: 1 } },
      { status: AssignmentStatus.REJECTED, _count: { _all: 2 } },
      { status: AssignmentStatus.EXPIRED, _count: { _all: 1 } },
      { status: AssignmentStatus.REASSIGNED, _count: { _all: 3 } },
    ]);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        ridersWithActiveAssignments: 2,
        averageAssignmentConfirmationTimeMs: 120_000,
        averageDeliveryTimeMs: 600_000,
        jobsApproachingDeadline: 4,
        overdueActiveJobs: 5,
      },
    ]);
    prismaMock.jobEvent.findMany.mockResolvedValue([
      {
        id: "event-id",
        eventType: "JOB_DELIVERED",
        jobId: "job-id",
        actor: "api",
        createdAt: new Date("2026-11-19T10:00:00.000Z"),
        job: { orderReference: "ORDER-123" },
      },
    ]);

    const result = await getDashboardOverview(
      new Date("2026-11-19T10:00:00.000Z"),
    );

    expect(result.jobs).toMatchObject({
      total: 9,
      awaitingConfirmation: 1,
      accepted: 1,
      pickedUp: 1,
      delivered: 2,
      manualQueue: 0,
      cancelled: 1,
      deliveryCompletionRate: 22.22,
    });
    expect(result.riders).toEqual({
      total: 5,
      available: 3,
      unavailable: 2,
      withActiveAssignments: 2,
    });
    expect(result.assignments).toEqual({
      pending: 2,
      accepted: 1,
      rejected: 2,
      expired: 1,
      reassignmentCount: 3,
    });
    expect(result.operationalPerformance).toMatchObject({
      deliveryCompletionRate: 22.22,
      averageAssignmentConfirmationTimeMs: 120_000,
      averageDeliveryTimeMs: 600_000,
      jobsApproachingDeadline: 4,
      overdueActiveJobs: 5,
      deadlineWarningWindowMinutes: 60,
    });
    expect(result.recentActivity[0]).toMatchObject({
      eventType: "JOB_DELIVERED",
      orderReference: "ORDER-123",
      actor: "api",
    });
    expect(prismaMock.job.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["status"] }),
    );
    expect(prismaMock.jobEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
      }),
    );

    const sql = prismaMock.$queryRaw.mock.calls[0]?.[0].join("");
    expect(sql).toContain('"jobsApproachingDeadline"');
    expect(sql).toContain('"overdueActiveJobs"');
    expect(sql).toContain('"deadline"');
  });

  it("returns zero-safe metrics for an empty database", async () => {
    prepareEmptyOverview();

    const result = await getDashboardOverview();

    expect(result.jobs.total).toBe(0);
    expect(result.jobs.deliveryCompletionRate).toBe(0);
    expect(result.riders).toMatchObject({
      total: 0,
      available: 0,
      unavailable: 0,
      withActiveAssignments: 0,
    });
    expect(result.operationalPerformance).toMatchObject({
      averageAssignmentConfirmationTimeMs: null,
      averageDeliveryTimeMs: null,
      jobsApproachingDeadline: 0,
      overdueActiveJobs: 0,
    });
    expect(result.recentActivity).toEqual([]);
  });

  it("returns UTC day buckets for a validated trend date range", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        date: "2026-11-18",
        createdJobs: 3,
        deliveredJobs: 1,
        cancelledJobs: 0,
        pendingJobs: 2,
      },
      {
        date: "2026-11-19",
        createdJobs: 0,
        deliveredJobs: 2,
        cancelledJobs: 1,
        pendingJobs: 0,
      },
    ]);
    const query = dashboardTrendsQuerySchema.parse({
      from: "2026-11-18",
      to: "2026-11-19",
    });

    const result = await getDashboardTrends(query);

    expect(result).toEqual({
      from: "2026-11-18",
      to: "2026-11-19",
      days: [
        {
          date: "2026-11-18",
          createdJobs: 3,
          deliveredJobs: 1,
          cancelledJobs: 0,
          pendingJobs: 2,
        },
        {
          date: "2026-11-19",
          createdJobs: 0,
          deliveredJobs: 2,
          cancelledJobs: 1,
          pendingJobs: 0,
        },
      ],
    });
    expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
    expect(prismaMock.$queryRaw.mock.calls[0]).toEqual(
      expect.arrayContaining([
        expect.any(Array),
        new Date("2026-11-18T00:00:00.000Z"),
        new Date("2026-11-19T00:00:00.000Z"),
        new Date("2026-11-18T00:00:00.000Z"),
        new Date("2026-11-20T00:00:00.000Z"),
      ]),
    );
  });

  it("validates ordered trend dates and caps the supported date range", () => {
    expect(
      dashboardTrendsQuerySchema.safeParse({
        from: "2026-11-20",
        to: "2026-11-19",
      }).success,
    ).toBe(false);
    expect(
      dashboardTrendsQuerySchema.safeParse({
        from: "2025-01-01",
        to: "2026-11-19",
      }).success,
    ).toBe(false);
    expect(
      dashboardTrendsQuerySchema.safeParse({ from: "not-a-date" }).success,
    ).toBe(false);
  });

  it("calculates zero-safe completion rates for delivery-zone aggregates", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        zoneId: "zone-one",
        zoneName: "Central",
        jobVolume: 4,
        deliveredJobs: 3,
        pendingJobs: 1,
      },
      {
        zoneId: "zone-two",
        zoneName: "Remote",
        jobVolume: 0,
        deliveredJobs: 0,
        pendingJobs: 0,
      },
    ]);

    const result = await getZonePerformance();

    expect(result).toEqual([
      {
        zoneId: "zone-one",
        zoneName: "Central",
        jobVolume: 4,
        deliveredJobs: 3,
        pendingJobs: 1,
        deliveryCompletionRate: 75,
      },
      {
        zoneId: "zone-two",
        zoneName: "Remote",
        jobVolume: 0,
        deliveredJobs: 0,
        pendingJobs: 0,
        deliveryCompletionRate: 0,
      },
    ]);
  });
});
