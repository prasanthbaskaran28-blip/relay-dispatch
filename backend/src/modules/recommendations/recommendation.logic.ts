import { AssignmentStatus, JobPriority } from "@prisma/client";
import {
  estimateRiderTravelTime,
  recommendationWeights,
} from "./recommendation.config.js";

export type RecommendationJob = {
  id: string;
  requiredCapacity: number;
  priority: JobPriority;
  deadline: Date | null;
  pickupZone: { id: string; name: string };
  deliveryZone: { id: string; name: string };
};

export type RecommendationRider = {
  id: string;
  name: string;
  isAvailable: boolean;
  maxCapacity: number;
  reservedCapacity: number;
  zones: Array<{ zone: { id: string; name: string } }>;
  assignments: Array<{ jobId: string; status: AssignmentStatus }>;
};

type EligibleRider = {
  rider: RecommendationRider;
  workload: number;
  remainingCapacity: number;
  estimatedTravelTime: number;
};

export type RiderExclusion = {
  riderId: string;
  riderName: string;
  reason: string;
};

export type RiderRecommendation = {
  riderId: string;
  riderName: string;
  workload: number;
  maxCapacity: number;
  reservedCapacity: number;
  remainingCapacity: number;
  estimatedTravelTime: number;
  score: number;
  reasons: string[];
};

export function filterEligibleRiders(
  riders: RecommendationRider[],
  job: RecommendationJob,
): { eligibleRiders: EligibleRider[]; excludedRiders: RiderExclusion[] } {
  const eligibleRiders: EligibleRider[] = [];
  const excludedRiders: RiderExclusion[] = [];

  for (const rider of riders) {
    const reasons: string[] = [];
    const zoneIds = new Set(rider.zones.map(({ zone }) => zone.id));
    const remainingCapacity = rider.maxCapacity - rider.reservedCapacity;

    if (!rider.isAvailable) reasons.push("Rider is unavailable");
    if (!zoneIds.has(job.pickupZone.id)) {
      reasons.push("Does not support the pickup zone");
    }
    if (!zoneIds.has(job.deliveryZone.id)) {
      reasons.push("Does not support the delivery zone");
    }
    if (remainingCapacity < job.requiredCapacity) {
      reasons.push("Insufficient remaining capacity");
    }
    if (
      rider.assignments.some(
        (assignment) =>
          assignment.jobId === job.id &&
          (assignment.status === AssignmentStatus.PENDING ||
            assignment.status === AssignmentStatus.ACCEPTED),
      )
    ) {
      reasons.push("Already has an active assignment for this job");
    }

    if (reasons.length > 0) {
      excludedRiders.push({
        riderId: rider.id,
        riderName: rider.name,
        reason: reasons.join("; "),
      });
      continue;
    }

    eligibleRiders.push({
      rider,
      workload: rider.assignments.length,
      remainingCapacity,
      estimatedTravelTime: estimateRiderTravelTime(
        rider.name,
        job.pickupZone.name,
        job.deliveryZone.name,
      ),
    });
  }

  excludedRiders.sort((left, right) =>
    left.riderName.localeCompare(right.riderName) ||
    left.riderId.localeCompare(right.riderId),
  );

  return { eligibleRiders, excludedRiders };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function rankEligibleRiders(
  eligibleRiders: EligibleRider[],
  job: RecommendationJob,
  now: Date,
): RiderRecommendation[] {
  if (eligibleRiders.length === 0) return [];

  const maxWorkload = Math.max(...eligibleRiders.map(({ workload }) => workload));
  const minTravelTime = Math.min(
    ...eligibleRiders.map(({ estimatedTravelTime }) => estimatedTravelTime),
  );
  const maxTravelTime = Math.max(
    ...eligibleRiders.map(({ estimatedTravelTime }) => estimatedTravelTime),
  );
  const weights = recommendationWeights[job.priority];
  const minutesToDeadline = job.deadline
    ? (job.deadline.getTime() - now.getTime()) / 60_000
    : null;

  return eligibleRiders
    .map((candidate) => {
      const { rider, workload, remainingCapacity, estimatedTravelTime } =
        candidate;
      const workloadScore =
        maxWorkload === 0 ? 1 : 1 - workload / (maxWorkload + 1);
      const travelTimeScore =
        maxTravelTime === minTravelTime
          ? 1
          : 1 -
            (estimatedTravelTime - minTravelTime) /
              (maxTravelTime - minTravelTime);
      const capacityFitScore = job.requiredCapacity / remainingCapacity;
      const deadlineScore =
        minutesToDeadline === null
          ? 1
          : clamp(
              (minutesToDeadline - estimatedTravelTime) /
                Math.max(minutesToDeadline, 1),
            );
      const score = Math.round(
        workloadScore * weights.workload +
          travelTimeScore * weights.travelTime +
          capacityFitScore * weights.capacityFit +
          deadlineScore * weights.deadline,
      );
      const reasons = [
        "Currently available",
        "Supports pickup and delivery zones",
        "Has sufficient remaining capacity",
        `Workload: ${workload} active assignment${workload === 1 ? "" : "s"}`,
        `Estimated travel time: ${estimatedTravelTime} minutes`,
        `${job.priority} priority is reflected in the score`,
        ...(job.deadline
          ? [
              minutesToDeadline !== null &&
              minutesToDeadline >= estimatedTravelTime
                ? "Estimated travel time fits the job deadline"
                : "Estimated travel time may not meet the job deadline",
            ]
          : []),
      ];

      return {
        riderId: rider.id,
        riderName: rider.name,
        workload,
        maxCapacity: rider.maxCapacity,
        reservedCapacity: rider.reservedCapacity,
        remainingCapacity,
        estimatedTravelTime,
        score,
        reasons,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.workload - right.workload ||
        left.estimatedTravelTime - right.estimatedTravelTime ||
        left.remainingCapacity - right.remainingCapacity ||
        left.riderName.localeCompare(right.riderName) ||
        left.riderId.localeCompare(right.riderId),
    );
}
