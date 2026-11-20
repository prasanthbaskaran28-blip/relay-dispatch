import { AssignmentStatus, JobStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRiderById, listRiders } from "./rider.service.js";
import { listRidersQuerySchema } from "./rider.validation.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    rider: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    assignment: { groupBy: vi.fn() },
  },
}));

vi.mock("../../config/database.js", () => ({ default: prismaMock }));

describe("rider service", () => {
  beforeEach(() => {
    prismaMock.rider.count.mockReset();
    prismaMock.rider.findMany.mockReset();
    prismaMock.rider.findUnique.mockReset();
    prismaMock.assignment.groupBy.mockReset();
  });

  it("filters riders by supported zone and returns active assignment counts", async () => {
    prismaMock.rider.findMany.mockResolvedValue([
      {
        id: "rider-id",
        name: "Rider One",
        phone: "555-0100",
        isAvailable: true,
        maxCapacity: 5,
        reservedCapacity: 2,
        zones: [{ zone: { id: "zone-id", name: "North" } }],
      },
    ]);
    prismaMock.rider.count.mockResolvedValue(15);
    prismaMock.assignment.groupBy.mockResolvedValue([
      { riderId: "rider-id", _count: { _all: 2 } },
    ]);

    const query = listRidersQuerySchema.parse({
      q: "Rider",
      isAvailable: "true",
      zoneId: "11111111-1111-4111-8111-111111111111",
      page: "2",
      pageSize: "10",
    });
    const result = await listRiders(query);

    expect(prismaMock.rider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { name: { contains: "Rider", mode: "insensitive" } },
            { phone: { contains: "Rider", mode: "insensitive" } },
          ],
          isAvailable: true,
          zones: { some: { zoneId: "11111111-1111-4111-8111-111111111111" } },
        }),
        skip: 10,
        take: 10,
      }),
    );
    expect(prismaMock.assignment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["riderId"],
        where: expect.objectContaining({
          riderId: { in: ["rider-id"] },
          status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
          capacityReserved: true,
        }),
      }),
    );
    expect(result.data[0]).toMatchObject({ activeAssignmentCount: 2 });
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 10,
      total: 15,
      totalPages: 2,
    });
  });

  it("returns assignment history while counting only active reserved assignments", async () => {
    const activeAssignment = {
      id: "active-assignment",
      status: AssignmentStatus.PENDING,
      assignedAt: new Date("2026-11-20T08:00:00.000Z"),
      confirmedAt: null,
      rejectedAt: null,
      expiredAt: null,
      rejectionReason: null,
      reassignmentReason: null,
      capacityReserved: true,
      job: {
        id: "active-job",
        orderReference: "ORDER-ACTIVE",
        requiredCapacity: 2,
        status: JobStatus.AWAITING_CONFIRMATION,
      },
    };
    const completedAssignment = {
      ...activeAssignment,
      id: "completed-assignment",
      status: AssignmentStatus.COMPLETED,
      capacityReserved: false,
      job: {
        ...activeAssignment.job,
        id: "completed-job",
        orderReference: "ORDER-COMPLETE",
        status: JobStatus.DELIVERED,
      },
    };
    prismaMock.rider.findUnique.mockResolvedValue({
      id: "rider-id",
      name: "Rider One",
      phone: "555-0100",
      isAvailable: true,
      maxCapacity: 5,
      reservedCapacity: 2,
      zones: [],
      assignments: [activeAssignment, completedAssignment],
    });

    const rider = await getRiderById("rider-id");

    expect(rider.assignmentHistory).toHaveLength(2);
    expect(rider.workload).toMatchObject({
      maxCapacity: 5,
      reservedCapacity: 2,
      availableCapacity: 3,
      activeAssignmentCount: 1,
      activeAssignments: [activeAssignment],
    });
  });
});
