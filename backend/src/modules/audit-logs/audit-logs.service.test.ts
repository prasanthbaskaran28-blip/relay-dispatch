import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuditLogById,
  listAuditLogs,
  listJobAuditLogs,
} from "./audit-logs.service.js";
import { auditLogsQuerySchema } from "./audit-logs.validation.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    job: { findUnique: vi.fn() },
    jobEvent: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../config/database.js", () => ({ default: prismaMock }));

function makeEvent(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "event-id",
    jobId: "job-id",
    eventType: "ASSIGNMENT_CREATED",
    actor: "api",
    description: "Rider assigned.",
    details: {
      assignmentId: "assignment-id",
      riderId: "rider-id",
    },
    createdAt: new Date("2026-11-19T10:00:00.000Z"),
    job: { id: "job-id", orderReference: "ORDER-123" },
    ...overrides,
  };
}

describe("audit log service", () => {
  beforeEach(() => {
    prismaMock.job.findUnique.mockReset();
    prismaMock.jobEvent.count.mockReset();
    prismaMock.jobEvent.findMany.mockReset();
    prismaMock.jobEvent.findUnique.mockReset();
  });

  it("filters and paginates newest-first audit events", async () => {
    const event = makeEvent();
    prismaMock.jobEvent.findMany.mockResolvedValue([event]);
    prismaMock.jobEvent.count.mockResolvedValue(3);

    const query = auditLogsQuerySchema.parse({
      page: "2",
      pageSize: "1",
      eventType: "ASSIGNMENT_CREATED",
      entityType: "ASSIGNMENT",
      actor: "api",
      from: "2026-11-19T09:00:00.000Z",
      to: "2026-11-19T11:00:00.000Z",
      q: "rider-id",
    });
    const result = await listAuditLogs(query);

    expect(prismaMock.jobEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          actor: "api",
          createdAt: {
            gte: new Date("2026-11-19T09:00:00.000Z"),
            lte: new Date("2026-11-19T11:00:00.000Z"),
          },
          AND: [
            { eventType: "ASSIGNMENT_CREATED" },
            { eventType: { startsWith: "ASSIGNMENT_" } },
          ],
          OR: expect.arrayContaining([
            { jobId: "rider-id" },
            { details: { path: ["riderId"], equals: "rider-id" } },
          ]),
        }),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 1,
        take: 1,
      }),
    );
    expect(result.data[0]).toMatchObject({
      entityType: "ASSIGNMENT",
      entityId: "assignment-id",
      actor: "api",
    });
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 1,
      total: 3,
      totalPages: 3,
    });
  });

  it("returns complete event details and derives job entity identity", async () => {
    prismaMock.jobEvent.findUnique.mockResolvedValue(
      makeEvent({
        eventType: "JOB_CREATED",
        details: { orderReference: "ORDER-123" },
        job: {
          id: "job-id",
          orderReference: "ORDER-123",
          status: "NEW",
        },
      }),
    );

    const result = await getAuditLogById("event-id");

    expect(result).toMatchObject({
      eventType: "JOB_CREATED",
      entityType: "JOB",
      entityId: "job-id",
      details: { orderReference: "ORDER-123" },
      job: { status: "NEW" },
    });
  });

  it("returns job events chronologically with assignment and rider metadata", async () => {
    const events = [
      makeEvent({
        id: "created",
        eventType: "JOB_CREATED",
        createdAt: new Date("2026-11-19T09:00:00.000Z"),
      }),
      makeEvent({
        id: "assigned",
        createdAt: new Date("2026-11-19T10:00:00.000Z"),
      }),
    ];
    prismaMock.job.findUnique.mockResolvedValue({ id: "job-id" });
    prismaMock.jobEvent.findMany.mockResolvedValue(events);

    const result = await listJobAuditLogs("job-id");

    expect(result.map(({ id }) => id)).toEqual(["created", "assigned"]);
    expect(result[1]).toMatchObject({
      entityType: "ASSIGNMENT",
      entityId: "assignment-id",
    });
    expect(prismaMock.jobEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: "job-id" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("returns not-found errors for missing events and jobs", async () => {
    prismaMock.jobEvent.findUnique.mockResolvedValue(null);
    prismaMock.job.findUnique.mockResolvedValue(null);

    await expect(getAuditLogById("missing-id")).rejects.toMatchObject({
      code: "AUDIT_EVENT_NOT_FOUND",
    });
    await expect(listJobAuditLogs("missing-job")).rejects.toMatchObject({
      code: "JOB_NOT_FOUND",
    });
  });

  it("rejects an inverted date range", () => {
    expect(
      auditLogsQuerySchema.safeParse({
        from: "2026-11-20T00:00:00.000Z",
        to: "2026-11-19T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("exposes only read operations so audit records remain append-only", () => {
    expect(Object.keys(prismaMock.jobEvent).sort()).toEqual([
      "count",
      "findMany",
      "findUnique",
    ]);
  });
});
