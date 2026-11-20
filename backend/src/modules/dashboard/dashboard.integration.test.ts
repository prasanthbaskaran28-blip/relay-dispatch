import "dotenv/config";
import {
  AssignmentStatus,
  JobPriority,
  JobStatus,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testApiToken = "dashboard-integration-token-with-more-than-32-bytes";
const originalApiToken = process.env.DISPATCH_API_TOKEN;
if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.DISPATCH_API_TOKEN = testApiToken;
}

type SeedZone = { id: string; name: string };
type SeedRider = {
  id: string;
  name: string;
  phone: string;
  isAvailable: boolean;
  maxCapacity: number;
};
type SeedJob = {
  id: string;
  orderReference: string;
  pickupZoneId: string;
  deliveryZoneId: string;
  status: JobStatus;
  createdAt: Date;
  deadline: Date | null;
};
type SeedAssignment = {
  id: string;
  jobId: string;
  riderId: string;
  status: AssignmentStatus;
  assignedAt: Date;
  confirmedAt: Date | null;
  capacityReserved: boolean;
};
type SeedEvent = {
  id: string;
  jobId: string;
  eventType: string;
  createdAt: Date;
};

const activeJobStatuses = new Set<JobStatus>([
  JobStatus.NEW,
  JobStatus.READY_FOR_ASSIGNMENT,
  JobStatus.AWAITING_CONFIRMATION,
  JobStatus.ACCEPTED,
  JobStatus.PICKED_UP,
  JobStatus.MANUAL_QUEUE,
]);

const rate = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100;

describe.skipIf(!testDatabaseUrl)("dashboard API integration", () => {
  let prisma: typeof import("../../config/database.js").default | undefined;
  let server: Server | undefined;
  let baseUrl: string;
  let trendFrom: string;
  let trendTo: string;
  let zones: SeedZone[] = [];
  let riders: SeedRider[] = [];
  let jobs: SeedJob[] = [];
  let assignments: SeedAssignment[] = [];
  let events: SeedEvent[] = [];
  let workflowRiders: SeedRider[] = [];

  const tag = randomUUID();

  function getPrisma() {
    if (!prisma) {
      throw new Error("Dashboard integration database is not connected.");
    }
    return prisma;
  }

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error("Set TEST_DATABASE_URL to run dashboard integration tests.");
    }

    const databaseName = decodeURIComponent(
      new URL(testDatabaseUrl).pathname.replace(/^\/+/, ""),
    );
    if (databaseName !== "relay_dispatch_test") {
      throw new Error(
        "TEST_DATABASE_URL must point to the relay_dispatch_test database.",
      );
    }

    const database = await import("../../config/database.js");
    const databaseClient = database.default;
    prisma = databaseClient;
    await databaseClient.$connect();
    const connectedDatabase = await databaseClient.$queryRaw<
      Array<{ database_name: string }>
    >`SELECT current_database() AS database_name`;
    if (connectedDatabase[0]?.database_name !== "relay_dispatch_test") {
      throw new Error(
        "Dashboard integration tests connected to a database other than relay_dispatch_test.",
      );
    }

    const [zoneCount, riderCount, jobCount, assignmentCount, eventCount] =
      await Promise.all([
        databaseClient.zone.count(),
        databaseClient.rider.count(),
        databaseClient.job.count(),
        databaseClient.assignment.count(),
        databaseClient.jobEvent.count(),
      ]);
    if (
      zoneCount + riderCount + jobCount + assignmentCount + eventCount !==
      0
    ) {
      throw new Error(
        "Dashboard integration tests require an empty test database; no records were changed.",
      );
    }

    const { default: app } = await import("../../app.js");
    const listeningServer = app.listen(0, "127.0.0.1");
    server = listeningServer;
    await new Promise<void>((resolve, reject) => {
      listeningServer.once("error", reject);
      listeningServer.once("listening", resolve);
    });
    const address = listeningServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not determine the dashboard integration server address.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.$transaction(async (transaction) => {
        await transaction.jobEvent.deleteMany({
          where: { jobId: { in: jobs.map(({ id }) => id) } },
        });
        await transaction.assignment.deleteMany({
          where: { id: { in: assignments.map(({ id }) => id) } },
        });
        await transaction.job.deleteMany({
          where: { id: { in: jobs.map(({ id }) => id) } },
        });
        await transaction.rider.deleteMany({
          where: { id: { in: riders.map(({ id }) => id) } },
        });
        await transaction.zone.deleteMany({
          where: { id: { in: zones.map(({ id }) => id) } },
        });
      });
      await prisma.$disconnect();
    }
    const activeServer = server;
    if (activeServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        activeServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
    if (originalApiToken === undefined) delete process.env.DISPATCH_API_TOKEN;
    else process.env.DISPATCH_API_TOKEN = originalApiToken;
  });

  async function getData<T>(path: string): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${testApiToken}` },
    });
    const body = (await response.json()) as { data?: T; error?: unknown };
    if (!response.ok || body.data === undefined) {
      throw new Error(
        `GET ${path} failed with status ${response.status}: ${JSON.stringify(body.error)}`,
      );
    }
    return body.data;
  }

  async function sendRequest<T>(
    path: string,
    method: string,
    body?: unknown,
    idempotencyKey?: string,
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${testApiToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = (await response.json()) as {
      data?: T;
      error?: { code: string; message: string };
    };
    return { status: response.status, ...payload };
  }

  async function expectDashboardMatchesDatabase() {
    const databaseClient = getPrisma();
    const [overview, jobGroups, riderGroups, assignmentGroups, activeRiders] =
      await Promise.all([
        getData<{
          jobs: Record<string, number>;
          riders: Record<string, number>;
          assignments: Record<string, number>;
        }>("/api/dashboard/overview"),
        databaseClient.job.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
        databaseClient.rider.groupBy({
          by: ["isAvailable"],
          _count: { _all: true },
        }),
        databaseClient.assignment.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
        databaseClient.assignment.findMany({
          where: {
            status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
            capacityReserved: true,
          },
          distinct: ["riderId"],
          select: { riderId: true },
        }),
      ]);
    const countFor = <T extends { _count: { _all: number } }>(
      rows: T[],
      predicate: (row: T) => boolean,
    ) => rows.find(predicate)?._count._all ?? 0;
    const jobCount = (status: JobStatus) =>
      countFor(jobGroups, (row) => row.status === status);
    const delivered = jobCount(JobStatus.DELIVERED);
    const totalJobs = jobGroups.reduce((total, row) => total + row._count._all, 0);

    expect(overview.jobs).toEqual({
      total: totalJobs,
      awaitingConfirmation: jobCount(JobStatus.AWAITING_CONFIRMATION),
      accepted: jobCount(JobStatus.ACCEPTED),
      pickedUp: jobCount(JobStatus.PICKED_UP),
      delivered,
      manualQueue: jobCount(JobStatus.MANUAL_QUEUE),
      cancelled: jobCount(JobStatus.CANCELLED),
      deliveryCompletionRate: rate(delivered, totalJobs),
    });
    expect(overview.riders).toEqual({
      total: riderGroups.reduce((total, row) => total + row._count._all, 0),
      available: countFor(riderGroups, (row) => row.isAvailable),
      unavailable: countFor(riderGroups, (row) => !row.isAvailable),
      withActiveAssignments: activeRiders.length,
    });
    expect(overview.assignments).toEqual({
      pending: countFor(
        assignmentGroups,
        (row) => row.status === AssignmentStatus.PENDING,
      ),
      accepted: countFor(
        assignmentGroups,
        (row) => row.status === AssignmentStatus.ACCEPTED,
      ),
      rejected: countFor(
        assignmentGroups,
        (row) => row.status === AssignmentStatus.REJECTED,
      ),
      expired: countFor(
        assignmentGroups,
        (row) => row.status === AssignmentStatus.EXPIRED,
      ),
      reassignmentCount: countFor(
        assignmentGroups,
        (row) => row.status === AssignmentStatus.REASSIGNED,
      ),
    });
  }

  async function expectTimeline(
    jobId: string,
    expectedEventTypes: string[],
  ): Promise<void> {
    const timeline = await getData<{
      events: Array<{ eventType: string }>;
    }>(`/api/jobs/${jobId}/timeline`);
    expect(timeline.events.map(({ eventType }) => eventType)).toEqual(
      expectedEventTypes,
    );
  }

  async function createWorkflowJob(
    label: string,
    requiredCapacity = 2,
    idempotencyKey?: string,
  ) {
    const body = {
      orderReference: `DISPATCH-IT-${tag}-${label}`,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      pickupZoneId: zones[0]!.id,
      deliveryZoneId: zones[1]!.id,
      requiredCapacity,
    };
    const response = await sendRequest<{
      id: string;
      orderReference: string;
      pickupZoneId: string;
      deliveryZoneId: string;
      status: JobStatus;
      createdAt: string;
      deadline: string | null;
    }>("/api/jobs", "POST", body);
    expect(response.status).toBe(201);
    if (!response.data) throw new Error("Job creation returned no data.");
    const job = response.data;
    jobs.push({
      id: job.id,
      orderReference: job.orderReference,
      pickupZoneId: job.pickupZoneId,
      deliveryZoneId: job.deliveryZoneId,
      status: job.status,
      createdAt: new Date(job.createdAt),
      deadline: job.deadline ? new Date(job.deadline) : null,
    });
    return { body, job };
  }

  async function getRider(riderId: string) {
    const rider = await getPrisma().rider.findUniqueOrThrow({
      where: { id: riderId },
      select: { reservedCapacity: true },
    });
    return rider.reservedCapacity;
  }

  async function rememberAssignments(jobId: string): Promise<void> {
    const records = await getPrisma().assignment.findMany({
      where: { jobId },
      select: {
        id: true,
        jobId: true,
        riderId: true,
        status: true,
        capacityReserved: true,
        assignedAt: true,
        confirmedAt: true,
      },
    });
    for (const record of records) {
      const tracked = assignments.find(({ id }) => id === record.id);
      if (tracked) {
        tracked.status = record.status;
        tracked.capacityReserved = record.capacityReserved;
      } else {
        assignments.push(record);
      }
    }
  }

  async function seedRecords() {
    const databaseClient = getPrisma();
    const seedTime = new Date();
    const todayStart = new Date(
      Date.UTC(
        seedTime.getUTCFullYear(),
        seedTime.getUTCMonth(),
        seedTime.getUTCDate(),
      ),
    );
    const fromStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const toExclusive = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    trendFrom = fromStart.toISOString().slice(0, 10);
    trendTo = todayStart.toISOString().slice(0, 10);
    const minutesFromNow = (minutes: number) =>
      new Date(seedTime.getTime() + minutes * 60_000);
    const hoursFrom = (date: Date, hours: number) =>
      new Date(date.getTime() + hours * 60 * 60 * 1000);

    zones = [
      { id: randomUUID(), name: `Dashboard ${tag} North` },
      { id: randomUUID(), name: `Dashboard ${tag} South` },
    ];
    riders = [
      {
        id: randomUUID(),
        name: `Dashboard ${tag} Rider 1`,
        phone: `+1555${tag.replaceAll("-", "").slice(0, 10)}`,
        isAvailable: true,
        maxCapacity: 4,
      },
      {
        id: randomUUID(),
        name: `Dashboard ${tag} Rider 2`,
        phone: `+1666${tag.replaceAll("-", "").slice(0, 10)}`,
        isAvailable: true,
        maxCapacity: 4,
      },
      {
        id: randomUUID(),
        name: `Dashboard ${tag} Rider 3`,
        phone: `+1777${tag.replaceAll("-", "").slice(0, 10)}`,
        isAvailable: false,
        maxCapacity: 4,
      },
    ];

    const jobSpecs: Array<{
      key: string;
      zoneIndex: number;
      status: JobStatus;
      createdAt: Date;
      deadline?: Date | null;
    }> = [
      {
        key: "new-from-boundary",
        zoneIndex: 0,
        status: JobStatus.NEW,
        createdAt: fromStart,
        deadline: minutesFromNow(30),
      },
      {
        key: "awaiting-from",
        zoneIndex: 1,
        status: JobStatus.AWAITING_CONFIRMATION,
        createdAt: hoursFrom(fromStart, 1),
        deadline: minutesFromNow(-10),
      },
      {
        key: "accepted-today",
        zoneIndex: 0,
        status: JobStatus.ACCEPTED,
        createdAt: hoursFrom(todayStart, 1),
        deadline: minutesFromNow(50),
      },
      {
        key: "picked-up-today",
        zoneIndex: 1,
        status: JobStatus.PICKED_UP,
        createdAt: hoursFrom(todayStart, 2),
        deadline: minutesFromNow(-60),
      },
      {
        key: "manual-queue-today",
        zoneIndex: 1,
        status: JobStatus.MANUAL_QUEUE,
        createdAt: hoursFrom(todayStart, 3),
        deadline: minutesFromNow(70),
      },
      {
        key: "delivered-from",
        zoneIndex: 0,
        status: JobStatus.DELIVERED,
        createdAt: hoursFrom(fromStart, 2),
      },
      {
        key: "delivered-today",
        zoneIndex: 0,
        status: JobStatus.DELIVERED,
        createdAt: hoursFrom(todayStart, 4),
      },
      {
        key: "cancelled-today",
        zoneIndex: 0,
        status: JobStatus.CANCELLED,
        createdAt: hoursFrom(todayStart, 5),
      },
      {
        key: "before-range",
        zoneIndex: 1,
        status: JobStatus.CANCELLED,
        createdAt: new Date(fromStart.getTime() - 1),
      },
      {
        key: "at-range-end",
        zoneIndex: 1,
        status: JobStatus.DELIVERED,
        createdAt: toExclusive,
      },
    ];

    const jobByKey = new Map<string, SeedJob>();
    jobs = jobSpecs.map((spec) => {
      const job: SeedJob = {
        id: randomUUID(),
        orderReference: `DASHBOARD-IT-${tag}-${spec.key}`,
        pickupZoneId: zones[0]!.id,
        deliveryZoneId: zones[spec.zoneIndex]!.id,
        status: spec.status,
        createdAt: spec.createdAt,
        deadline: spec.deadline ?? null,
      };
      jobByKey.set(spec.key, job);
      return job;
    });

    const assignedAtOne = minutesFromNow(-30);
    const assignedAtTwo = minutesFromNow(-40);
    assignments = [
      {
        id: randomUUID(),
        jobId: jobByKey.get("accepted-today")!.id,
        riderId: riders[0]!.id,
        status: AssignmentStatus.ACCEPTED,
        assignedAt: assignedAtOne,
        confirmedAt: new Date(assignedAtOne.getTime() + 2 * 60_000),
        capacityReserved: true,
      },
      {
        id: randomUUID(),
        jobId: jobByKey.get("picked-up-today")!.id,
        riderId: riders[1]!.id,
        status: AssignmentStatus.ACCEPTED,
        assignedAt: assignedAtTwo,
        confirmedAt: new Date(assignedAtTwo.getTime() + 4 * 60_000),
        capacityReserved: true,
      },
      {
        id: randomUUID(),
        jobId: jobByKey.get("new-from-boundary")!.id,
        riderId: riders[2]!.id,
        status: AssignmentStatus.PENDING,
        assignedAt: minutesFromNow(-5),
        confirmedAt: null,
        capacityReserved: true,
      },
      {
        id: randomUUID(),
        jobId: jobByKey.get("awaiting-from")!.id,
        riderId: riders[0]!.id,
        status: AssignmentStatus.REJECTED,
        assignedAt: minutesFromNow(-90),
        confirmedAt: null,
        capacityReserved: false,
      },
      {
        id: randomUUID(),
        jobId: jobByKey.get("manual-queue-today")!.id,
        riderId: riders[1]!.id,
        status: AssignmentStatus.EXPIRED,
        assignedAt: minutesFromNow(-120),
        confirmedAt: null,
        capacityReserved: false,
      },
      {
        id: randomUUID(),
        jobId: jobByKey.get("cancelled-today")!.id,
        riderId: riders[2]!.id,
        status: AssignmentStatus.REASSIGNED,
        assignedAt: minutesFromNow(-150),
        confirmedAt: null,
        capacityReserved: false,
      },
    ];

    const deliveredFrom = jobByKey.get("delivered-from")!;
    const deliveredToday = jobByKey.get("delivered-today")!;
    const deliveredAtEnd = jobByKey.get("at-range-end")!;
    const cancelledToday = jobByKey.get("cancelled-today")!;
    events = [
      {
        id: randomUUID(),
        jobId: deliveredFrom.id,
        eventType: "JOB_DELIVERED",
        createdAt: new Date(deliveredFrom.createdAt.getTime() + 20 * 60_000),
      },
      {
        id: randomUUID(),
        jobId: deliveredToday.id,
        eventType: "JOB_DELIVERED",
        createdAt: new Date(deliveredToday.createdAt.getTime() + 40 * 60_000),
      },
      {
        id: randomUUID(),
        jobId: deliveredAtEnd.id,
        eventType: "JOB_DELIVERED",
        createdAt: new Date(deliveredAtEnd.createdAt.getTime() + 30 * 60_000),
      },
      {
        id: randomUUID(),
        jobId: cancelledToday.id,
        eventType: "JOB_CANCELLED",
        createdAt: new Date(cancelledToday.createdAt.getTime() + 5 * 60_000),
      },
    ];

    await databaseClient.$transaction(async (transaction) => {
      await transaction.zone.createMany({ data: zones });
      await transaction.rider.createMany({ data: riders });
      await transaction.job.createMany({
        data: jobs.map((job) => ({
          ...job,
          requiredCapacity: 1,
          priority: JobPriority.NORMAL,
        })),
      });
      await transaction.assignment.createMany({
        data: assignments.map((assignment) => ({
          ...assignment,
          confirmationDeadline: minutesFromNow(60),
        })),
      });
      await transaction.jobEvent.createMany({
        data: events.map((event) => ({
          ...event,
          actor: "dashboard-integration-test",
          description: "Dashboard integration fixture.",
          details: { testTag: tag } satisfies Prisma.InputJsonValue,
        })),
      });
    });
  }

  it("protects dispatcher APIs while keeping health checks public", async () => {
    const jobId = randomUUID();
    const assignmentId = randomUUID();
    const protectedRequests = [
      fetch(`${baseUrl}/api/riders`),
      fetch(`${baseUrl}/api/assignments/${assignmentId}/accept`, {
        method: "POST",
      }),
      fetch(`${baseUrl}/api/jobs/${jobId}/cancel`, { method: "POST" }),
      fetch(`${baseUrl}/api/audit-logs`),
    ];
    const responses = await Promise.all(protectedRequests);
    expect(responses.map(({ status }) => status)).toEqual([401, 401, 401, 401]);

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
  });

  it("returns empty metrics and zero-filled trend days for an empty database", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const [overview, trends, zonePerformance] = await Promise.all([
      getData<{
        jobs: { total: number; deliveryCompletionRate: number };
        riders: {
          total: number;
          available: number;
          unavailable: number;
          withActiveAssignments: number;
        };
        assignments: Record<string, number>;
        operationalPerformance: {
          averageAssignmentConfirmationTimeMs: number | null;
          averageDeliveryTimeMs: number | null;
          jobsApproachingDeadline: number;
          overdueActiveJobs: number;
        };
        recentActivity: unknown[];
      }>("/api/dashboard/overview"),
      getData<{ from: string; to: string; days: Array<Record<string, number | string>> }>(
        `/api/dashboard/trends?from=${yesterday}&to=${today}`,
      ),
      getData<unknown[]>("/api/dashboard/zone-performance"),
    ]);

    expect(overview.jobs).toEqual({
      total: 0,
      awaitingConfirmation: 0,
      accepted: 0,
      pickedUp: 0,
      delivered: 0,
      manualQueue: 0,
      cancelled: 0,
      deliveryCompletionRate: 0,
    });
    expect(overview.riders).toEqual({
      total: 0,
      available: 0,
      unavailable: 0,
      withActiveAssignments: 0,
    });
    expect(overview.assignments).toEqual({
      pending: 0,
      accepted: 0,
      rejected: 0,
      expired: 0,
      reassignmentCount: 0,
    });
    expect(overview.operationalPerformance).toMatchObject({
      deliveryCompletionRate: 0,
      averageAssignmentConfirmationTimeMs: null,
      averageDeliveryTimeMs: null,
      jobsApproachingDeadline: 0,
      overdueActiveJobs: 0,
    });
    expect(overview.recentActivity).toEqual([]);
    expect(trends).toEqual({
      from: yesterday,
      to: today,
      days: [yesterday, today].map((date) => ({
        date,
        createdJobs: 0,
        deliveredJobs: 0,
        cancelledJobs: 0,
        pendingJobs: 0,
      })),
    });
    expect(zonePerformance).toEqual([]);
  });

  it("matches seeded PostgreSQL records for overview, trends, and zone performance", async () => {
    await seedRecords();

    const metricsTime = new Date();
    const from = trendFrom;
    const to = trendTo;
    const [overview, trendResult, zonePerformance] = await Promise.all([
      getData<{
        jobs: Record<string, number>;
        riders: Record<string, number>;
        assignments: Record<string, number>;
        operationalPerformance: Record<string, number | null>;
      }>("/api/dashboard/overview"),
      getData<{
        from: string;
        to: string;
        days: Array<{
          date: string;
          createdJobs: number;
          deliveredJobs: number;
          cancelledJobs: number;
          pendingJobs: number;
        }>;
      }>(`/api/dashboard/trends?from=${from}&to=${to}`),
      getData<
        Array<{
          zoneId: string;
          zoneName: string;
          jobVolume: number;
          deliveredJobs: number;
          pendingJobs: number;
          deliveryCompletionRate: number;
        }>
      >("/api/dashboard/zone-performance"),
    ]);

    const deliveredCount = jobs.filter(
      ({ status }) => status === JobStatus.DELIVERED,
    ).length;
    const activeJobCount = jobs.filter(({ status }) =>
      activeJobStatuses.has(status),
    ).length;
    const confirmationDurations = assignments
      .filter(
        (assignment) =>
          assignment.status === AssignmentStatus.ACCEPTED &&
          assignment.confirmedAt !== null,
      )
      .map(
        (assignment) =>
          assignment.confirmedAt!.getTime() - assignment.assignedAt.getTime(),
      );
    const jobCreatedById = new Map(jobs.map((job) => [job.id, job.createdAt]));
    const deliveryDurations = events
      .filter((event) => event.eventType === "JOB_DELIVERED")
      .map(
        (event) => event.createdAt.getTime() - jobCreatedById.get(event.jobId)!.getTime(),
      );
    const expectedApproaching = jobs.filter(
      (job) =>
        activeJobStatuses.has(job.status) &&
        job.deadline !== null &&
        job.deadline > metricsTime &&
        job.deadline <= new Date(metricsTime.getTime() + 60 * 60_000),
    ).length;
    const expectedOverdue = jobs.filter(
      (job) =>
        activeJobStatuses.has(job.status) &&
        job.deadline !== null &&
        job.deadline < metricsTime,
    ).length;
    const activeRiderCount = new Set(
      assignments
        .filter(
          (assignment) =>
            (assignment.status === AssignmentStatus.PENDING ||
              assignment.status === AssignmentStatus.ACCEPTED) &&
            assignment.capacityReserved,
        )
        .map(({ riderId }) => riderId),
    ).size;

    expect.soft(overview.jobs).toMatchObject({
      total: jobs.length,
      awaitingConfirmation: jobs.filter(
        ({ status }) => status === JobStatus.AWAITING_CONFIRMATION,
      ).length,
      accepted: jobs.filter(({ status }) => status === JobStatus.ACCEPTED).length,
      pickedUp: jobs.filter(({ status }) => status === JobStatus.PICKED_UP).length,
      delivered: deliveredCount,
      manualQueue: jobs.filter(
        ({ status }) => status === JobStatus.MANUAL_QUEUE,
      ).length,
      cancelled: jobs.filter(({ status }) => status === JobStatus.CANCELLED).length,
      deliveryCompletionRate: rate(deliveredCount, jobs.length),
    });
    expect.soft(overview.riders).toEqual({
      total: riders.length,
      available: riders.filter(({ isAvailable }) => isAvailable).length,
      unavailable: riders.filter(({ isAvailable }) => !isAvailable).length,
      withActiveAssignments: activeRiderCount,
    });
    expect.soft(overview.assignments).toEqual({
      pending: assignments.filter(
        ({ status }) => status === AssignmentStatus.PENDING,
      ).length,
      accepted: assignments.filter(
        ({ status }) => status === AssignmentStatus.ACCEPTED,
      ).length,
      rejected: assignments.filter(
        ({ status }) => status === AssignmentStatus.REJECTED,
      ).length,
      expired: assignments.filter(
        ({ status }) => status === AssignmentStatus.EXPIRED,
      ).length,
      reassignmentCount: assignments.filter(
        ({ status }) => status === AssignmentStatus.REASSIGNED,
      ).length,
    });
    expect.soft(overview.operationalPerformance).toMatchObject({
      deliveryCompletionRate: rate(deliveredCount, jobs.length),
      averageAssignmentConfirmationTimeMs:
        confirmationDurations.reduce((sum, duration) => sum + duration, 0) /
        confirmationDurations.length,
      averageDeliveryTimeMs:
        deliveryDurations.reduce((sum, duration) => sum + duration, 0) /
        deliveryDurations.length,
      jobsApproachingDeadline: expectedApproaching,
      overdueActiveJobs: expectedOverdue,
      deadlineWarningWindowMinutes: 60,
    });

    const expectedDates: string[] = [];
    for (
      let date = new Date(`${from}T00:00:00.000Z`);
      date <= new Date(`${to}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + 1)
    ) {
      expectedDates.push(date.toISOString().slice(0, 10));
    }
    const expectedTrends = expectedDates.map((date) => {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const dayJobs = jobs.filter(
        ({ createdAt }) => createdAt >= start && createdAt < end,
      );
      const dayEvents = events.filter(
        ({ createdAt }) => createdAt >= start && createdAt < end,
      );
      return {
        date,
        createdJobs: dayJobs.length,
        deliveredJobs: dayEvents.filter(
          ({ eventType }) => eventType === "JOB_DELIVERED",
        ).length,
        cancelledJobs: dayEvents.filter(({ eventType }) =>
          ["JOB_CANCELLED", "MANUAL_QUEUE_DISMISSED"].includes(eventType),
        ).length,
        pendingJobs: dayJobs.filter(({ status }) =>
          activeJobStatuses.has(status),
        ).length,
      };
    });
    expect.soft(trendResult).toEqual({ from, to, days: expectedTrends });

    const expectedZones = zones
      .map((zone) => {
        const zoneJobs = jobs.filter(
          ({ deliveryZoneId }) => deliveryZoneId === zone.id,
        );
        const zoneDelivered = zoneJobs.filter(
          ({ status }) => status === JobStatus.DELIVERED,
        ).length;
        return {
          zoneId: zone.id,
          zoneName: zone.name,
          jobVolume: zoneJobs.length,
          deliveredJobs: zoneDelivered,
          pendingJobs: zoneJobs.filter(({ status }) =>
            activeJobStatuses.has(status),
          ).length,
          deliveryCompletionRate: rate(zoneDelivered, zoneJobs.length),
        };
      })
      .sort((left, right) => left.zoneName.localeCompare(right.zoneName));
    expect.soft(zonePerformance).toEqual(expectedZones);
  });

  it("creates eligible rider fixtures through the API", async () => {
    const definitions = [
      { name: `Workflow ${tag} Alpha`, maxCapacity: 2 },
      { name: `Workflow ${tag} Bravo`, maxCapacity: 4 },
      { name: `Workflow ${tag} Charlie`, maxCapacity: 6 },
      { name: `Workflow ${tag} Limited`, maxCapacity: 1 },
    ];

    for (const definition of definitions) {
      const riderResponse = await sendRequest<SeedRider>(
        "/api/riders",
        "POST",
        {
          ...definition,
          phone: `+1555${randomUUID().replaceAll("-", "").slice(0, 10)}`,
          isAvailable: true,
        },
      );
      expect(riderResponse.status).toBe(201);
      if (!riderResponse.data) {
        throw new Error("Rider creation returned no data.");
      }

      const rider = riderResponse.data;
      const trackedRider = {
        id: rider.id,
        name: rider.name,
        phone: rider.phone,
        isAvailable: rider.isAvailable,
        maxCapacity: rider.maxCapacity,
      };
      workflowRiders.push(trackedRider);
      riders.push(trackedRider);

      const zonesResponse = await sendRequest(
        `/api/riders/${rider.id}/zones`,
        "PATCH",
        { zoneIds: zones.map(({ id }) => id) },
      );
      expect(zonesResponse.status).toBe(200);
    }

    await expectDashboardMatchesDatabase();
  });

  it("creates jobs, recommends and assigns an eligible rider, and accepts once", async () => {
    const idempotencyKey = `create-${tag}`;
    const { body, job } = await createWorkflowJob(
      "accepted-lifecycle",
      2,
      idempotencyKey,
    );
    const replay = await sendRequest<{ id: string }>(
      "/api/jobs",
      "POST",
      body,
    );
    expect(replay.status).toBe(200);
    expect(replay.data?.id).toBe(job.id);
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, ["JOB_CREATED"]);

    const recommendations = await getData<{
      recommendations: Array<{ riderId: string }>;
      excludedRiders: Array<{ riderId: string; reason: string }>;
    }>(`/api/jobs/${job.id}/recommendations`);
    expect(recommendations.recommendations.length).toBeGreaterThan(0);
    const limitedRider = workflowRiders.find(({ name }) =>
      name.endsWith("Limited"),
    )!;
    expect(recommendations.excludedRiders).toContainEqual(
      expect.objectContaining({
        riderId: limitedRider.id,
        reason: expect.stringContaining("Insufficient remaining capacity"),
      }),
    );

    const riderId = recommendations.recommendations[0]!.riderId;
    const initialReservedCapacity = await getRider(riderId);
    const assignmentKey = `assign-${tag}-accepted`;
    const assignmentBody = { riderId };
    const assigned = await sendRequest<{ id: string; riderId: string }>(
      `/api/jobs/${job.id}/assignments`,
      "POST",
      assignmentBody,
      assignmentKey,
    );
    expect(assigned.status).toBe(201);
    if (!assigned.data) throw new Error("Assignment creation returned no data.");
    const duplicateAssignment = await sendRequest<{ id: string }>(
      `/api/jobs/${job.id}/assignments`,
      "POST",
      assignmentBody,
      assignmentKey,
    );
    expect(duplicateAssignment.status).toBe(200);
    expect(duplicateAssignment.data?.id).toBe(assigned.data.id);
    await rememberAssignments(job.id);
    expect(await getRider(riderId)).toBe(initialReservedCapacity + 2);
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, ["JOB_CREATED", "ASSIGNMENT_CREATED"]);

    const accepted = await sendRequest(
      `/api/assignments/${assigned.data.id}/accept`,
      "POST",
    );
    expect(accepted.status).toBe(200);
    await rememberAssignments(job.id);
    expect(await getRider(riderId)).toBe(initialReservedCapacity + 2);
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, [
      "JOB_CREATED",
      "ASSIGNMENT_CREATED",
      "ASSIGNMENT_ACCEPTED",
    ]);

    const duplicateAcceptance = await sendRequest<{ code: string }>(
      `/api/assignments/${assigned.data.id}/accept`,
      "POST",
    );
    expect(duplicateAcceptance.status).toBe(409);
    expect(duplicateAcceptance.error?.code).toBe("ASSIGNMENT_NOT_PENDING");
    expect(await getRider(riderId)).toBe(initialReservedCapacity + 2);
    await rememberAssignments(job.id);
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, [
      "JOB_CREATED",
      "ASSIGNMENT_CREATED",
      "ASSIGNMENT_ACCEPTED",
    ]);

    const changedDuplicate = await sendRequest<{ code: string }>(
      "/api/jobs",
      "POST",
      { ...body, requiredCapacity: 1 },
    );
    expect(changedDuplicate.status).toBe(409);
  });

  it("rejects assignments, releases capacity, and rolls back insufficient-capacity attempts", async () => {
    const { job } = await createWorkflowJob("rejected", 2);
    const recommendation = await getData<{
      recommendations: Array<{ riderId: string }>;
    }>(`/api/jobs/${job.id}/recommendations`);
    const riderId = recommendation.recommendations[0]!.riderId;
    const initialReservedCapacity = await getRider(riderId);
    const assigned = await sendRequest<{ id: string }>(
      `/api/jobs/${job.id}/assignments`,
      "POST",
      { riderId },
      `assign-${tag}-rejected`,
    );
    expect(assigned.status).toBe(201);
    if (!assigned.data) throw new Error("Assignment creation returned no data.");
    await rememberAssignments(job.id);
    expect(await getRider(riderId)).toBe(initialReservedCapacity + 2);
    await expectDashboardMatchesDatabase();

    const rejected = await sendRequest(
      `/api/assignments/${assigned.data.id}/reject`,
      "POST",
      { rejectionReason: "Integration test rejection" },
    );
    expect(rejected.status).toBe(200);
    await rememberAssignments(job.id);
    expect(await getRider(riderId)).toBe(initialReservedCapacity);
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, [
      "JOB_CREATED",
      "ASSIGNMENT_CREATED",
      "ASSIGNMENT_REJECTED",
    ]);

    const { job: oversizedJob } = await createWorkflowJob(
      "insufficient-capacity",
      7,
    );
    const insufficientRiderId = workflowRiders[2]!.id;
    const insufficientRiderCapacity = await getRider(insufficientRiderId);
    const oversizedRecommendation = await getData<{
      recommendations: Array<{ riderId: string }>;
    }>(`/api/jobs/${oversizedJob.id}/recommendations`);
    expect(oversizedRecommendation.recommendations).toHaveLength(0);
    const capacityFailure = await sendRequest<{ code: string }>(
      `/api/jobs/${oversizedJob.id}/assignments`,
      "POST",
      { riderId: insufficientRiderId },
      `assign-${tag}-insufficient`,
    );
    expect(capacityFailure.status).toBe(409);
    expect(capacityFailure.error?.code).toBe("RIDER_NOT_ELIGIBLE");
    await rememberAssignments(oversizedJob.id);
    expect(
      await getPrisma().assignment.count({ where: { jobId: oversizedJob.id } }),
    ).toBe(0);
    expect(await getRider(insufficientRiderId)).toBe(insufficientRiderCapacity);
    await expectDashboardMatchesDatabase();
    await expectTimeline(oversizedJob.id, ["JOB_CREATED"]);
  });

  it("expires timed-out assignments and retries manual-queue assignments", async () => {
    const { job } = await createWorkflowJob("timeout-retry", 2);
    const recommendation = await getData<{
      recommendations: Array<{ riderId: string }>;
    }>(`/api/jobs/${job.id}/recommendations`);
    const riderId = recommendation.recommendations[0]!.riderId;
    const initialReservedCapacity = await getRider(riderId);
    const assigned = await sendRequest<{ id: string }>(
      `/api/jobs/${job.id}/assignments`,
      "POST",
      { riderId },
      `assign-${tag}-timeout`,
    );
    expect(assigned.status).toBe(201);
    if (!assigned.data) throw new Error("Assignment creation returned no data.");
    await getPrisma().assignment.update({
      where: { id: assigned.data.id },
      data: { confirmationDeadline: new Date(Date.now() - 1_000) },
    });

    const { processExpiredAssignments } = await import(
      "../../workers/assignment-timeout.worker.js"
    );
    await processExpiredAssignments(new Date());
    await rememberAssignments(job.id);
    expect(await getRider(riderId)).toBe(initialReservedCapacity);
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, [
      "JOB_CREATED",
      "ASSIGNMENT_CREATED",
      "ASSIGNMENT_EXPIRED",
    ]);

    const retryKey = `retry-${tag}`;
    const retry = await sendRequest<{
      recommendations: Array<{ riderId: string }>;
    }>(`/api/manual-queue/${job.id}/retry`, "POST", undefined, retryKey);
    expect(retry.status).toBe(200);
    expect(retry.data?.recommendations.length).toBeGreaterThan(0);
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, [
      "JOB_CREATED",
      "ASSIGNMENT_CREATED",
      "ASSIGNMENT_EXPIRED",
      "MANUAL_QUEUE_RETRY",
    ]);

    const duplicateRetries = await Promise.all([
      sendRequest<{
        recommendations: Array<{ riderId: string }>;
        excludedRiders: Array<{ riderId: string; reason: string }>;
      }>(`/api/manual-queue/${job.id}/retry`, "POST", undefined, retryKey),
      sendRequest<{
        recommendations: Array<{ riderId: string }>;
        excludedRiders: Array<{ riderId: string; reason: string }>;
      }>(`/api/manual-queue/${job.id}/retry`, "POST", undefined, retryKey),
    ]);
    expect(duplicateRetries.map(({ status }) => status)).toEqual([200, 200]);
    expect(duplicateRetries[0]?.data).toEqual(retry.data);
    expect(duplicateRetries[1]?.data).toEqual(retry.data);
    expect(
      await getPrisma().jobEvent.count({
        where: { jobId: job.id, eventType: "MANUAL_QUEUE_RETRY" },
      }),
    ).toBe(1);
    const retryEvent = await getPrisma().jobEvent.findFirstOrThrow({
      where: {
        jobId: job.id,
        eventType: "MANUAL_QUEUE_RETRY",
        idempotencyKey: retryKey,
      },
    });
    expect(retryEvent.details).toMatchObject({
      idempotencyKey: retryKey,
      response: retry.data,
    });

    const retryRiderId = retry.data!.recommendations[0]!.riderId;
    const retryRiderInitialCapacity = await getRider(retryRiderId);
    const retriedAssignment = await sendRequest<{ id: string }>(
      `/api/jobs/${job.id}/assignments`,
      "POST",
      { riderId: retryRiderId },
      `assign-${tag}-retried`,
    );
    expect(retriedAssignment.status).toBe(201);
    if (!retriedAssignment.data) {
      throw new Error("Retried assignment creation returned no data.");
    }
    await rememberAssignments(job.id);
    expect(await getRider(retryRiderId)).toBe(retryRiderInitialCapacity + 2);
    await expectDashboardMatchesDatabase();

    const retryRejection = await sendRequest(
      `/api/assignments/${retriedAssignment.data.id}/reject`,
      "POST",
      { rejectionReason: "Retry rejected for cleanup verification" },
    );
    expect(retryRejection.status).toBe(200);
    await rememberAssignments(job.id);
    expect(await getRider(retryRiderId)).toBe(retryRiderInitialCapacity);
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, [
      "JOB_CREATED",
      "ASSIGNMENT_CREATED",
      "ASSIGNMENT_EXPIRED",
      "MANUAL_QUEUE_RETRY",
      "ASSIGNMENT_CREATED",
      "ASSIGNMENT_REJECTED",
    ]);
  });

  it("reassigns before pickup and completes ACCEPTED to PICKED_UP to DELIVERED", async () => {
    const { job } = await createWorkflowJob("reassign-deliver", 2);
    const initialRecommendations = await getData<{
      recommendations: Array<{ riderId: string }>;
    }>(`/api/jobs/${job.id}/recommendations`);
    const firstRiderId = initialRecommendations.recommendations[0]!.riderId;
    const firstRiderInitialCapacity = await getRider(firstRiderId);
    const original = await sendRequest<{ id: string }>(
      `/api/jobs/${job.id}/assignments`,
      "POST",
      { riderId: firstRiderId },
      `assign-${tag}-reassign-original`,
    );
    expect(original.status).toBe(201);
    if (!original.data) throw new Error("Assignment creation returned no data.");
    await rememberAssignments(job.id);

    const accepted = await sendRequest(
      `/api/assignments/${original.data.id}/accept`,
      "POST",
    );
    expect(accepted.status).toBe(200);
    await rememberAssignments(job.id);
    await expectDashboardMatchesDatabase();

    const updatedRecommendations = await getData<{
      recommendations: Array<{ riderId: string }>;
    }>(`/api/jobs/${job.id}/recommendations`);
    const secondRiderId = updatedRecommendations.recommendations.find(
      ({ riderId }) => riderId !== firstRiderId,
    )!.riderId;
    const secondRiderInitialCapacity = await getRider(secondRiderId);
    const reassignment = await sendRequest<{ id: string }>(
      `/api/jobs/${job.id}/reassignments`,
      "POST",
      {
        assignmentId: original.data.id,
        riderId: secondRiderId,
        reassignmentReason: "Integration test reassignment before pickup",
        overrideReason: "Use a different eligible rider",
      },
      `reassign-${tag}`,
    );
    expect(reassignment.status).toBe(201);
    if (!reassignment.data) {
      throw new Error("Reassignment returned no data.");
    }
    await rememberAssignments(job.id);
    expect(await getRider(firstRiderId)).toBe(firstRiderInitialCapacity);
    expect(await getRider(secondRiderId)).toBe(
      secondRiderInitialCapacity + 2,
    );
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, [
      "JOB_CREATED",
      "ASSIGNMENT_CREATED",
      "ASSIGNMENT_ACCEPTED",
      "ASSIGNMENT_REASSIGNED",
    ]);

    const replacementAccepted = await sendRequest(
      `/api/assignments/${reassignment.data.id}/accept`,
      "POST",
    );
    expect(replacementAccepted.status).toBe(200);
    await rememberAssignments(job.id);
    await expectDashboardMatchesDatabase();

    const pickup = await sendRequest(
      `/api/jobs/${job.id}/pickup`,
      "POST",
    );
    expect(pickup.status).toBe(200);
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, [
      "JOB_CREATED",
      "ASSIGNMENT_CREATED",
      "ASSIGNMENT_ACCEPTED",
      "ASSIGNMENT_REASSIGNED",
      "ASSIGNMENT_ACCEPTED",
      "JOB_PICKED_UP",
    ]);

    const lateReassignment = await sendRequest<{ code: string }>(
      `/api/jobs/${job.id}/reassignments`,
      "POST",
      {
        assignmentId: reassignment.data.id,
        riderId: firstRiderId,
        reassignmentReason: "Must not reassign after pickup",
      },
      `reassign-${tag}-after-pickup`,
    );
    expect(lateReassignment.status).toBe(409);
    expect(lateReassignment.error?.code).toBe("JOB_NOT_REASSIGNABLE");
    await expectDashboardMatchesDatabase();

    const delivered = await sendRequest(
      `/api/jobs/${job.id}/deliver`,
      "POST",
    );
    expect(delivered.status).toBe(200);
    await rememberAssignments(job.id);
    expect(await getRider(secondRiderId)).toBe(secondRiderInitialCapacity);
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, [
      "JOB_CREATED",
      "ASSIGNMENT_CREATED",
      "ASSIGNMENT_ACCEPTED",
      "ASSIGNMENT_REASSIGNED",
      "ASSIGNMENT_ACCEPTED",
      "JOB_PICKED_UP",
      "JOB_DELIVERED",
    ]);

    const duplicateDelivery = await sendRequest<{ code: string }>(
      `/api/jobs/${job.id}/deliver`,
      "POST",
    );
    expect(duplicateDelivery.status).toBe(409);
    expect(duplicateDelivery.error?.code).toBe("JOB_NOT_PICKED_UP");
    await expectDashboardMatchesDatabase();
  });

  it("cancels before pickup, releases reserved capacity, and rejects invalid transitions", async () => {
    const { job } = await createWorkflowJob("cancel-before-pickup", 2);
    const invalidDelivery = await sendRequest<{ code: string }>(
      `/api/jobs/${job.id}/deliver`,
      "POST",
    );
    expect(invalidDelivery.status).toBe(409);
    expect(invalidDelivery.error?.code).toBe("JOB_NOT_PICKED_UP");
    await expectDashboardMatchesDatabase();

    const recommendations = await getData<{
      recommendations: Array<{ riderId: string }>;
    }>(`/api/jobs/${job.id}/recommendations`);
    const riderId = recommendations.recommendations[0]!.riderId;
    const initialReservedCapacity = await getRider(riderId);
    const assigned = await sendRequest<{ id: string }>(
      `/api/jobs/${job.id}/assignments`,
      "POST",
      { riderId },
      `assign-${tag}-cancel`,
    );
    expect(assigned.status).toBe(201);
    if (!assigned.data) throw new Error("Assignment creation returned no data.");
    await rememberAssignments(job.id);
    expect(await getRider(riderId)).toBe(initialReservedCapacity + 2);
    await expectDashboardMatchesDatabase();

    const cancelled = await sendRequest(
      `/api/jobs/${job.id}/cancel`,
      "POST",
      { reason: "Integration test cancellation before pickup" },
    );
    expect(cancelled.status).toBe(200);
    await rememberAssignments(job.id);
    expect(await getRider(riderId)).toBe(initialReservedCapacity);
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, [
      "JOB_CREATED",
      "ASSIGNMENT_CREATED",
      "JOB_CANCELLED",
    ]);

    const invalidPickup = await sendRequest<{ code: string }>(
      `/api/jobs/${job.id}/pickup`,
      "POST",
    );
    expect(invalidPickup.status).toBe(409);
    expect(invalidPickup.error?.code).toBe("JOB_NOT_READY_FOR_PICKUP");
    await expectDashboardMatchesDatabase();
    await expectTimeline(job.id, [
      "JOB_CREATED",
      "ASSIGNMENT_CREATED",
      "JOB_CANCELLED",
    ]);
  });
});
