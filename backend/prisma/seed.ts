import { JobPriority, JobStatus, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const zoneNames = [
  "Chennai Central",
  "Tambaram",
  "Velachery",
  "Guindy",
  "Anna Nagar",
] as const;

const riders = [
  {
    name: "Arun",
    phone: "+919000000101",
    isAvailable: true,
    maxCapacity: 6,
    reservedCapacity: 0,
    zones: ["Chennai Central", "Guindy", "Anna Nagar"],
  },
  {
    name: "Karthik",
    phone: "+919000000102",
    isAvailable: true,
    maxCapacity: 4,
    reservedCapacity: 0,
    zones: ["Tambaram", "Chennai Central", "Guindy"],
  },
  {
    name: "Rahul",
    phone: "+919000000103",
    isAvailable: false,
    maxCapacity: 5,
    reservedCapacity: 0,
    zones: ["Velachery", "Guindy", "Tambaram"],
  },
  {
    name: "Suresh",
    phone: "+919000000104",
    isAvailable: true,
    maxCapacity: 3,
    reservedCapacity: 0,
    zones: ["Anna Nagar", "Chennai Central", "Velachery"],
  },
  {
    name: "Vignesh",
    phone: "+919000000105",
    isAvailable: false,
    maxCapacity: 4,
    reservedCapacity: 0,
    zones: ["Tambaram", "Velachery", "Chennai Central"],
  },
] as const;

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

const jobs = [
  {
    orderReference: "RELAY-SEED-1001",
    pickupZone: "Chennai Central",
    deliveryZone: "Guindy",
    requiredCapacity: 1,
    priority: JobPriority.LOW,
    status: JobStatus.NEW,
    deadline: hoursFromNow(8),
  },
  {
    orderReference: "RELAY-SEED-1002",
    pickupZone: "Tambaram",
    deliveryZone: "Chennai Central",
    requiredCapacity: 2,
    priority: JobPriority.NORMAL,
    status: JobStatus.READY_FOR_ASSIGNMENT,
    deadline: hoursFromNow(4),
  },
  {
    orderReference: "RELAY-SEED-1003",
    pickupZone: "Velachery",
    deliveryZone: "Anna Nagar",
    requiredCapacity: 3,
    priority: JobPriority.HIGH,
    status: JobStatus.READY_FOR_ASSIGNMENT,
    deadline: hoursFromNow(3),
  },
  {
    orderReference: "RELAY-SEED-1004",
    pickupZone: "Guindy",
    deliveryZone: "Tambaram",
    requiredCapacity: 1,
    priority: JobPriority.URGENT,
    status: JobStatus.READY_FOR_ASSIGNMENT,
    deadline: hoursFromNow(1.5),
  },
  {
    orderReference: "RELAY-SEED-1005",
    pickupZone: "Anna Nagar",
    deliveryZone: "Velachery",
    requiredCapacity: 2,
    priority: JobPriority.NORMAL,
    status: JobStatus.MANUAL_QUEUE,
    deadline: hoursFromNow(5),
  },
] as const;

async function main(): Promise<void> {
  const counts = await prisma.$transaction(async (transaction) => {
    const zoneIds = new Map<string, string>();
    for (const name of zoneNames) {
      const zone = await transaction.zone.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      zoneIds.set(name, zone.id);
    }

    for (const rider of riders) {
      const savedRider = await transaction.rider.upsert({
        where: { phone: rider.phone },
        update: {},
        create: {
          name: rider.name,
          phone: rider.phone,
          isAvailable: rider.isAvailable,
          maxCapacity: rider.maxCapacity,
          reservedCapacity: rider.reservedCapacity,
        },
      });

      for (const zoneName of rider.zones) {
        const zoneId = zoneIds.get(zoneName);
        if (!zoneId) {
          throw new Error(`Seed configuration references unknown zone "${zoneName}".`);
        }

        await transaction.riderZone.upsert({
          where: {
            riderId_zoneId: { riderId: savedRider.id, zoneId },
          },
          update: {},
          create: { riderId: savedRider.id, zoneId },
        });
      }
    }

    for (const job of jobs) {
      const pickupZoneId = zoneIds.get(job.pickupZone);
      const deliveryZoneId = zoneIds.get(job.deliveryZone);
      if (!pickupZoneId || !deliveryZoneId) {
        throw new Error(`Seed job "${job.orderReference}" references an unknown zone.`);
      }

      const existingJob = await transaction.job.findUnique({
        where: { orderReference: job.orderReference },
        select: { id: true },
      });

      const savedJob = await transaction.job.upsert({
        where: { orderReference: job.orderReference },
        update: {},
        create: {
          orderReference: job.orderReference,
          pickupZoneId,
          deliveryZoneId,
          requiredCapacity: job.requiredCapacity,
          priority: job.priority,
          status: job.status,
          deadline: job.deadline,
        },
      });

      if (!existingJob) {
        await transaction.jobEvent.create({
          data: {
            jobId: savedJob.id,
            eventType: "JOB_CREATED",
            actor: "seed",
            description: "Sample delivery job created by the Prisma seed script.",
            details: { orderReference: savedJob.orderReference },
          },
        });
      }
    }

    const [zoneCount, riderCount, riderZoneCount, jobCount, jobEventCount] =
      await Promise.all([
        transaction.zone.count(),
        transaction.rider.count(),
        transaction.riderZone.count(),
        transaction.job.count(),
        transaction.jobEvent.count(),
      ]);

    return { zoneCount, riderCount, riderZoneCount, jobCount, jobEventCount };
  });

  console.log("Prisma seed completed:", counts);
}

main()
  .catch((error: unknown) => {
    console.error("Prisma seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
