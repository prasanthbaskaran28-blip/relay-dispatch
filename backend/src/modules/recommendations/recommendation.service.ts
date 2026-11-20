import { AssignmentStatus, Prisma } from "@prisma/client";
import prisma from "../../config/database.js";
import { AppError } from "../../utils/app-error.js";
import {
  filterEligibleRiders,
  rankEligibleRiders,
  type RecommendationJob,
  type RecommendationRider,
} from "./recommendation.logic.js";

const jobRelations = {
  pickupZone: { select: { id: true, name: true } },
  deliveryZone: { select: { id: true, name: true } },
} satisfies Prisma.JobInclude;

const riderRelations = {
  zones: { select: { zone: { select: { id: true, name: true } } } },
  assignments: {
    where: {
      status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
      capacityReserved: true,
    },
    select: { jobId: true, status: true },
  },
} satisfies Prisma.RiderInclude;

export async function getJobRecommendations(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: jobRelations,
  });
  if (!job) throw new AppError(404, "JOB_NOT_FOUND", "Delivery job not found.");

  const riders = await prisma.rider.findMany({
    include: riderRelations,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  const recommendationJob: RecommendationJob = job;
  const recommendationRiders: RecommendationRider[] = riders;
  const { eligibleRiders, excludedRiders } = filterEligibleRiders(
    recommendationRiders,
    recommendationJob,
  );

  return {
    jobId: job.id,
    recommendations: rankEligibleRiders(
      eligibleRiders,
      recommendationJob,
      new Date(),
    ),
    excludedRiders,
  };
}
