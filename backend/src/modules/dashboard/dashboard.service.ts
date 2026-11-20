import {
  AssignmentStatus,
  JobStatus,
} from "@prisma/client";
import prisma from "../../config/database.js";
import type { DashboardTrendsQuery } from "./dashboard.validation.js";

const approachingDeadlineMinutes = 60;

type OperationalAggregates = {
  ridersWithActiveAssignments: number;
  averageAssignmentConfirmationTimeMs: number | null;
  averageDeliveryTimeMs: number | null;
  jobsApproachingDeadline: number;
  overdueActiveJobs: number;
};

type TrendRow = {
  date: string;
  createdJobs: number;
  deliveredJobs: number;
  cancelledJobs: number;
  pendingJobs: number;
};

type ZoneRow = {
  zoneId: string;
  zoneName: string;
  jobVolume: number;
  deliveredJobs: number;
  pendingJobs: number;
};

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function countFor<T extends { _count: { _all: number } }>(
  rows: T[],
  predicate: (row: T) => boolean,
): number {
  return rows.find(predicate)?._count._all ?? 0;
}

function toUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftUtcDate(value: string, days: number): string {
  const date = toUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

function resolveTrendRange(query: DashboardTrendsQuery) {
  const today = formatUtcDate(new Date());
  const to = query.to ?? today;
  const from = query.from ?? shiftUtcDate(to, -6);
  return { from, to };
}

export async function getDashboardOverview(now = new Date()) {
  const approachingDeadlineAt = new Date(
    now.getTime() + approachingDeadlineMinutes * 60_000,
  );

  const [
    jobGroups,
    riderGroups,
    assignmentGroups,
    operationalRows,
    recentEvents,
  ] = await Promise.all([
    prisma.job.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.rider.groupBy({
      by: ["isAvailable"],
      _count: { _all: true },
    }),
    prisma.assignment.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.$queryRaw<OperationalAggregates[]>`
      SELECT
        (
          SELECT COUNT(DISTINCT a."riderId")::int
          FROM "Assignment" a
          WHERE a."status" IN ('PENDING', 'ACCEPTED')
            AND a."capacityReserved" = TRUE
        ) AS "ridersWithActiveAssignments",
        (
          SELECT AVG(
            EXTRACT(EPOCH FROM (a."confirmedAt" - a."assignedAt")) * 1000
          )::float8
          FROM "Assignment" a
          WHERE a."status" = 'ACCEPTED'
            AND a."confirmedAt" IS NOT NULL
        ) AS "averageAssignmentConfirmationTimeMs",
        (
          SELECT AVG(
            EXTRACT(EPOCH FROM (e."createdAt" - j."createdAt")) * 1000
          )::float8
          FROM "JobEvent" e
          JOIN "Job" j ON j."id" = e."jobId"
          WHERE e."eventType" = 'JOB_DELIVERED'
        ) AS "averageDeliveryTimeMs",
        (
          SELECT COUNT(*)::int
          FROM "Job" j
          WHERE j."status"::text IN (
            'NEW', 'READY_FOR_ASSIGNMENT', 'AWAITING_CONFIRMATION',
            'ACCEPTED', 'PICKED_UP', 'MANUAL_QUEUE'
          )
            AND j."deadline" > (${now}::timestamptz AT TIME ZONE 'UTC')
            AND j."deadline" <= (
              ${approachingDeadlineAt}::timestamptz AT TIME ZONE 'UTC'
            )
        ) AS "jobsApproachingDeadline",
        (
          SELECT COUNT(*)::int
          FROM "Job" j
          WHERE j."status"::text IN (
            'NEW', 'READY_FOR_ASSIGNMENT', 'AWAITING_CONFIRMATION',
            'ACCEPTED', 'PICKED_UP', 'MANUAL_QUEUE'
          )
            AND j."deadline" < (${now}::timestamptz AT TIME ZONE 'UTC')
        ) AS "overdueActiveJobs"
    `,
    prisma.jobEvent.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      select: {
        id: true,
        eventType: true,
        jobId: true,
        actor: true,
        createdAt: true,
        job: { select: { orderReference: true } },
      },
    }),
  ]);

  const jobs = {
    total: jobGroups.reduce((total, row) => total + row._count._all, 0),
    awaitingConfirmation: countFor(
      jobGroups,
      (row) => row.status === JobStatus.AWAITING_CONFIRMATION,
    ),
    accepted: countFor(jobGroups, (row) => row.status === JobStatus.ACCEPTED),
    pickedUp: countFor(jobGroups, (row) => row.status === JobStatus.PICKED_UP),
    delivered: countFor(jobGroups, (row) => row.status === JobStatus.DELIVERED),
    manualQueue: countFor(
      jobGroups,
      (row) => row.status === JobStatus.MANUAL_QUEUE,
    ),
    cancelled: countFor(
      jobGroups,
      (row) => row.status === JobStatus.CANCELLED,
    ),
  };
  const riders = {
    total: riderGroups.reduce((total, row) => total + row._count._all, 0),
    available: countFor(riderGroups, (row) => row.isAvailable),
    unavailable: countFor(riderGroups, (row) => !row.isAvailable),
  };
  const assignments = {
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
  };
  const operational = operationalRows[0] ?? {
    ridersWithActiveAssignments: 0,
    averageAssignmentConfirmationTimeMs: null,
    averageDeliveryTimeMs: null,
    jobsApproachingDeadline: 0,
    overdueActiveJobs: 0,
  };

  return {
    jobs: {
      ...jobs,
      deliveryCompletionRate: percentage(jobs.delivered, jobs.total),
    },
    riders: {
      ...riders,
      withActiveAssignments: operational.ridersWithActiveAssignments,
    },
    assignments,
    operationalPerformance: {
      deliveryCompletionRate: percentage(jobs.delivered, jobs.total),
      averageAssignmentConfirmationTimeMs:
        operational.averageAssignmentConfirmationTimeMs,
      averageDeliveryTimeMs: operational.averageDeliveryTimeMs,
      jobsApproachingDeadline: operational.jobsApproachingDeadline,
      overdueActiveJobs: operational.overdueActiveJobs,
      deadlineWarningWindowMinutes: approachingDeadlineMinutes,
    },
    recentActivity: recentEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      jobId: event.jobId,
      orderReference: event.job.orderReference,
      actor: event.actor,
      timestamp: event.createdAt,
    })),
  };
}

export async function getDashboardTrends(query: DashboardTrendsQuery) {
  const { from, to } = resolveTrendRange(query);
  const rangeStart = toUtcDate(from);
  const rangeEnd = toUtcDate(shiftUtcDate(to, 1));
  const days = await prisma.$queryRaw<TrendRow[]>`
    WITH calendar AS (
      SELECT generate_series(
        (${rangeStart}::timestamptz AT TIME ZONE 'UTC'),
        (${toUtcDate(to)}::timestamptz AT TIME ZONE 'UTC'),
        INTERVAL '1 day'
      ) AS day
    ),
    jobs_by_day AS (
      SELECT
        date_trunc('day', j."createdAt") AS day,
        COUNT(*)::int AS "createdJobs",
        COUNT(*) FILTER (WHERE j."status"::text IN (
          'NEW', 'READY_FOR_ASSIGNMENT', 'AWAITING_CONFIRMATION',
          'ACCEPTED', 'PICKED_UP', 'MANUAL_QUEUE'
        ))::int AS "pendingJobs"
      FROM "Job" j
      WHERE j."createdAt" >= (${rangeStart}::timestamptz AT TIME ZONE 'UTC')
        AND j."createdAt" < (${rangeEnd}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY 1
    ),
    events_by_day AS (
      SELECT
        date_trunc('day', e."createdAt") AS day,
        COUNT(*) FILTER (
          WHERE e."eventType" = 'JOB_DELIVERED'
        )::int AS "deliveredJobs",
        COUNT(*) FILTER (
          WHERE e."eventType" IN ('JOB_CANCELLED', 'MANUAL_QUEUE_DISMISSED')
        )::int AS "cancelledJobs"
      FROM "JobEvent" e
      WHERE e."createdAt" >= (${rangeStart}::timestamptz AT TIME ZONE 'UTC')
        AND e."createdAt" < (${rangeEnd}::timestamptz AT TIME ZONE 'UTC')
        AND e."eventType" IN (
          'JOB_DELIVERED', 'JOB_CANCELLED', 'MANUAL_QUEUE_DISMISSED'
        )
      GROUP BY 1
    )
    SELECT
      to_char(c.day, 'YYYY-MM-DD') AS date,
      COALESCE(j."createdJobs", 0)::int AS "createdJobs",
      COALESCE(e."deliveredJobs", 0)::int AS "deliveredJobs",
      COALESCE(e."cancelledJobs", 0)::int AS "cancelledJobs",
      COALESCE(j."pendingJobs", 0)::int AS "pendingJobs"
    FROM calendar c
    LEFT JOIN jobs_by_day j ON j.day = c.day
    LEFT JOIN events_by_day e ON e.day = c.day
    ORDER BY c.day ASC
  `;

  return { from, to, days };
}

export async function getZonePerformance() {
  const rows = await prisma.$queryRaw<ZoneRow[]>`
    SELECT
      z."id" AS "zoneId",
      z."name" AS "zoneName",
      COUNT(j."id")::int AS "jobVolume",
      COUNT(j."id") FILTER (
        WHERE j."status"::text = 'DELIVERED'
      )::int AS "deliveredJobs",
      COUNT(j."id") FILTER (
        WHERE j."status"::text IN (
          'NEW', 'READY_FOR_ASSIGNMENT', 'AWAITING_CONFIRMATION',
          'ACCEPTED', 'PICKED_UP', 'MANUAL_QUEUE'
        )
      )::int AS "pendingJobs"
    FROM "Zone" z
    LEFT JOIN "Job" j ON j."deliveryZoneId" = z."id"
    GROUP BY z."id", z."name"
    ORDER BY z."name" ASC, z."id" ASC
  `;

  return rows.map((row) => ({
    ...row,
    deliveryCompletionRate: percentage(row.deliveredJobs, row.jobVolume),
  }));
}
