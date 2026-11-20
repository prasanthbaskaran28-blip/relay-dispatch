import { Prisma } from "@prisma/client";
import prisma from "../../config/database.js";
import { AppError } from "../../utils/app-error.js";
import type { AuditLogsQuery } from "./audit-logs.validation.js";

const eventJobSelection = {
  id: true,
  orderReference: true,
} satisfies Prisma.JobSelect;

const auditEventSelection = {
  id: true,
  jobId: true,
  eventType: true,
  actor: true,
  description: true,
  details: true,
  createdAt: true,
  job: { select: eventJobSelection },
} satisfies Prisma.JobEventSelect;

type AuditEvent = Prisma.JobEventGetPayload<{
  select: typeof auditEventSelection;
}>;

function getStringDetail(
  details: Prisma.JsonValue | null,
  key: string,
): string | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return undefined;
  }
  const value = details[key];
  return typeof value === "string" ? value : undefined;
}

function toAuditLog(event: AuditEvent) {
  const isAssignmentEvent = event.eventType.startsWith("ASSIGNMENT_");
  return {
    ...event,
    entityType: isAssignmentEvent ? "ASSIGNMENT" : "JOB",
    entityId: isAssignmentEvent
      ? getStringDetail(event.details, "assignmentId") ?? event.jobId
      : event.jobId,
  };
}

function buildAuditWhere(query: AuditLogsQuery): Prisma.JobEventWhereInput {
  const where: Prisma.JobEventWhereInput = {};

  if (query.actor) where.actor = query.actor;
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }

  const eventTypeFilters: Prisma.JobEventWhereInput[] = [];
  if (query.eventType) {
    eventTypeFilters.push({ eventType: query.eventType });
  }
  if (query.entityType === "ASSIGNMENT") {
    eventTypeFilters.push({ eventType: { startsWith: "ASSIGNMENT_" } });
  } else if (query.entityType === "JOB") {
    eventTypeFilters.push({
      NOT: { eventType: { startsWith: "ASSIGNMENT_" } },
    });
  }
  if (eventTypeFilters.length === 1) {
    Object.assign(where, eventTypeFilters[0]);
  } else if (eventTypeFilters.length > 1) {
    where.AND = eventTypeFilters;
  }

  if (query.q) {
    where.OR = [
      { jobId: query.q },
      {
        job: {
          is: {
            orderReference: { contains: query.q, mode: "insensitive" },
          },
        },
      },
      { details: { path: ["assignmentId"], equals: query.q } },
      { details: { path: ["previousAssignmentId"], equals: query.q } },
      { details: { path: ["riderId"], equals: query.q } },
      { details: { path: ["previousRiderId"], equals: query.q } },
      { details: { path: ["assignmentIds"], array_contains: [query.q] } },
      { details: { path: ["riderIds"], array_contains: [query.q] } },
      { details: { path: ["eligibleRiderIds"], array_contains: [query.q] } },
    ];
  }

  return where;
}

export async function listAuditLogs(query: AuditLogsQuery) {
  const where = buildAuditWhere(query);
  const [events, total] = await Promise.all([
    prisma.jobEvent.findMany({
      where,
      select: auditEventSelection,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.jobEvent.count({ where }),
  ]);

  return {
    data: events.map(toAuditLog),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

export async function getAuditLogById(eventId: string) {
  const event = await prisma.jobEvent.findUnique({
    where: { id: eventId },
    select: {
      ...auditEventSelection,
      job: {
        select: {
          id: true,
          orderReference: true,
          status: true,
        },
      },
    },
  });
  if (!event) {
    throw new AppError(404, "AUDIT_EVENT_NOT_FOUND", "Audit event not found.");
  }
  return toAuditLog(event);
}

export async function listJobAuditLogs(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true },
  });
  if (!job) {
    throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");
  }

  const events = await prisma.jobEvent.findMany({
    where: { jobId },
    select: auditEventSelection,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return events.map(toAuditLog);
}
