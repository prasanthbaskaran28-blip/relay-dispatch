import { AssignmentStatus, Prisma } from "@prisma/client";
import prisma from "../../config/database.js";
import { AppError } from "../../utils/app-error.js";
import type {
  CreateRiderInput,
  ListRidersQuery,
  UpdateRiderAvailabilityInput,
  UpdateRiderInput,
  UpdateRiderZonesInput,
} from "./rider.validation.js";

const activeAssignmentStatuses: AssignmentStatus[] = [
  AssignmentStatus.PENDING,
  AssignmentStatus.ACCEPTED,
];

const riderListRelations = {
  zones: {
    select: {
      zone: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.RiderInclude;

const riderDetailsRelations = {
  ...riderListRelations,
  assignments: {
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      assignedAt: true,
      confirmedAt: true,
      rejectedAt: true,
      expiredAt: true,
      rejectionReason: true,
      reassignmentReason: true,
      capacityReserved: true,
      job: {
        select: {
          id: true,
          orderReference: true,
          requiredCapacity: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.RiderInclude;

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function createRider(input: CreateRiderInput) {
  const existingRider = await prisma.rider.findUnique({
    where: { phone: input.phone },
    select: { id: true },
  });
  if (existingRider) {
    throw new AppError(
      409,
      "RIDER_PHONE_EXISTS",
      "A rider with this phone number already exists.",
    );
  }

  try {
    return await prisma.rider.create({
      data: {
        name: input.name,
        phone: input.phone,
        maxCapacity: input.maxCapacity,
        isAvailable: input.isAvailable,
      },
      include: riderListRelations,
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    throw new AppError(
      409,
      "RIDER_PHONE_EXISTS",
      "A rider with this phone number already exists.",
    );
  }
}

export async function updateRider(id: string, input: UpdateRiderInput) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const currentRider = await transaction.rider.findUnique({
        where: { id },
        select: { reservedCapacity: true },
      });
      if (!currentRider) {
        throw new AppError(404, "RIDER_NOT_FOUND", "Rider not found.");
      }
      if (
        input.maxCapacity !== undefined &&
        currentRider.reservedCapacity > input.maxCapacity
      ) {
        throw new AppError(
          409,
          "RIDER_CAPACITY_BELOW_RESERVED",
          "Maximum capacity cannot be less than reserved capacity.",
        );
      }

      const result = await transaction.rider.updateMany({
        where: {
          id,
          ...(input.maxCapacity !== undefined
            ? { reservedCapacity: { lte: input.maxCapacity } }
            : {}),
        },
        data: input,
      });
      if (result.count !== 1) {
        const latestRider = await transaction.rider.findUnique({
          where: { id },
          select: { reservedCapacity: true },
        });
        if (!latestRider) {
          throw new AppError(404, "RIDER_NOT_FOUND", "Rider not found.");
        }
        if (
          input.maxCapacity !== undefined &&
          latestRider.reservedCapacity > input.maxCapacity
        ) {
          throw new AppError(
            409,
            "RIDER_CAPACITY_BELOW_RESERVED",
            "Maximum capacity cannot be less than reserved capacity.",
          );
        }
        throw new AppError(
          409,
          "RIDER_CHANGED",
          "The rider changed while this request was being processed. Retry the request.",
        );
      }

      return transaction.rider.findUniqueOrThrow({
        where: { id },
        include: riderListRelations,
      });
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    throw new AppError(
      409,
      "RIDER_PHONE_EXISTS",
      "A rider with this phone number already exists.",
    );
  }
}

export async function updateRiderAvailability(
  id: string,
  input: UpdateRiderAvailabilityInput,
) {
  const isAvailable = input.availability === "AVAILABLE";

  return prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Rider" WHERE "id" = ${id} FOR UPDATE
      `;
      const currentRider = await transaction.rider.findUnique({
        where: { id },
        select: { isAvailable: true },
      });
      if (!currentRider) {
        throw new AppError(404, "RIDER_NOT_FOUND", "Rider not found.");
      }

      if (currentRider.isAvailable === isAvailable) {
        return transaction.rider.findUniqueOrThrow({
          where: { id },
          include: riderListRelations,
        });
      }

      if (currentRider.isAvailable && !isAvailable) {
        const activeAssignments = await transaction.assignment.count({
          where: {
            riderId: id,
            status: {
              in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED],
            },
            capacityReserved: true,
          },
        });
        if (activeAssignments > 0) {
          throw new AppError(
            409,
            "ACTIVE_ASSIGNMENTS_EXIST",
            "Cannot mark rider as unavailable while active assignments are pending or accepted.",
          );
        }
      }

      const result = await transaction.rider.updateMany({
        where: { id, isAvailable: currentRider.isAvailable },
        data: { isAvailable },
      });
      if (result.count !== 1) {
        throw new AppError(
          409,
          "RIDER_CHANGED",
          "The rider changed while this request was being processed. Retry the request.",
        );
      }

      return transaction.rider.findUniqueOrThrow({
        where: { id },
        include: riderListRelations,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function updateRiderZones(
  riderId: string,
  input: UpdateRiderZonesInput,
) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Rider" WHERE "id" = ${riderId} FOR UPDATE
    `;
    const rider = await transaction.rider.findUnique({
      where: { id: riderId },
      select: { id: true },
    });
    if (!rider) {
      throw new AppError(404, "RIDER_NOT_FOUND", "Rider not found.");
    }

    if (input.zoneIds.length > 0) {
      const zones = await transaction.zone.findMany({
        where: { id: { in: input.zoneIds } },
        select: { id: true },
      });
      const existingZoneIds = new Set(zones.map((zone) => zone.id));
      const missingZoneId = input.zoneIds.find(
        (zoneId) => !existingZoneIds.has(zoneId),
      );
      if (missingZoneId) {
        throw new AppError(
          404,
          "ZONE_NOT_FOUND",
          `Zone '${missingZoneId}' was not found.`,
        );
      }
    }

    await transaction.riderZone.deleteMany({ where: { riderId } });
    if (input.zoneIds.length > 0) {
      await transaction.riderZone.createMany({
        data: input.zoneIds.map((zoneId) => ({ riderId, zoneId })),
      });
    }

    return transaction.rider.findUniqueOrThrow({
      where: { id: riderId },
      include: riderListRelations,
    });
  });
}

export async function listRiders(query: ListRidersQuery) {
  const { page, pageSize, q, isAvailable, zoneId } = query;
  const where: Prisma.RiderWhereInput = {};

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
    ];
  }
  if (isAvailable !== undefined) where.isAvailable = isAvailable;
  if (zoneId) where.zones = { some: { zoneId } };

  const [riders, total] = await Promise.all([
    prisma.rider.findMany({
      where,
      include: riderListRelations,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.rider.count({ where }),
  ]);
  const activeAssignmentCounts =
    riders.length === 0
      ? []
      : await prisma.assignment.groupBy({
          by: ["riderId"],
          where: {
            riderId: { in: riders.map((rider) => rider.id) },
            status: { in: activeAssignmentStatuses },
            capacityReserved: true,
          },
          _count: { _all: true },
        });
  const activeCountByRiderId = new Map(
    activeAssignmentCounts.map((entry) => [entry.riderId, entry._count._all]),
  );

  return {
    data: riders.map((rider) => ({
      ...rider,
      activeAssignmentCount: activeCountByRiderId.get(rider.id) ?? 0,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getRiderById(id: string) {
  const rider = await prisma.rider.findUnique({
    where: { id },
    include: riderDetailsRelations,
  });
  if (!rider) {
    throw new AppError(404, "RIDER_NOT_FOUND", "Rider not found.");
  }

  const { assignments, ...riderDetails } = rider;
  const activeAssignments = assignments.filter(
    (assignment) =>
      assignment.capacityReserved &&
      activeAssignmentStatuses.includes(assignment.status),
  );
  return {
    ...riderDetails,
    assignmentHistory: assignments,
    workload: {
      maxCapacity: rider.maxCapacity,
      reservedCapacity: rider.reservedCapacity,
      availableCapacity: rider.maxCapacity - rider.reservedCapacity,
      activeAssignmentCount: activeAssignments.length,
      activeAssignments,
    },
  };
}
