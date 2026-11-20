import { AssignmentStatus, JobPriority } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  filterEligibleRiders,
  rankEligibleRiders,
  type RecommendationJob,
  type RecommendationRider,
} from "./recommendation.logic.js";

const job: RecommendationJob = {
  id: "job-1",
  requiredCapacity: 2,
  priority: JobPriority.NORMAL,
  deadline: null,
  pickupZone: { id: "pickup", name: "Chennai Central" },
  deliveryZone: { id: "delivery", name: "Guindy" },
};

function makeRider(
  name: string,
  overrides: Partial<RecommendationRider> = {},
): RecommendationRider {
  return {
    id: name,
    name,
    isAvailable: true,
    maxCapacity: 5,
    reservedCapacity: 1,
    zones: [
      { zone: { id: "pickup", name: "Chennai Central" } },
      { zone: { id: "delivery", name: "Guindy" } },
    ],
    assignments: [],
    ...overrides,
  };
}

describe("recommendation eligibility and ranking", () => {
  it("excludes unavailable, zone-mismatched, and capacity-constrained riders", () => {
    const riders = [
      makeRider("Available"),
      makeRider("Unavailable", { isAvailable: false }),
      makeRider("No pickup", {
        zones: [{ zone: { id: "delivery", name: "Guindy" } }],
      }),
      makeRider("No delivery", {
        zones: [{ zone: { id: "pickup", name: "Chennai Central" } }],
      }),
      makeRider("Over capacity", { reservedCapacity: 4 }),
    ];

    const result = filterEligibleRiders(riders, job);

    expect(result.eligibleRiders.map(({ rider }) => rider.name)).toEqual([
      "Available",
    ]);
    expect(result.excludedRiders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          riderName: "Unavailable",
          reason: expect.stringContaining("unavailable"),
        }),
        expect.objectContaining({
          riderName: "No pickup",
          reason: expect.stringContaining("pickup zone"),
        }),
        expect.objectContaining({
          riderName: "No delivery",
          reason: expect.stringContaining("delivery zone"),
        }),
        expect.objectContaining({
          riderName: "Over capacity",
          reason: expect.stringContaining("Insufficient remaining capacity"),
        }),
      ]),
    );
  });

  it("excludes a rider already actively assigned to this job", () => {
    const rider = makeRider("Assigned", {
      assignments: [{ jobId: job.id, status: AssignmentStatus.PENDING }],
    });

    const result = filterEligibleRiders([rider], job);

    expect(result.eligibleRiders).toHaveLength(0);
    expect(result.excludedRiders[0]?.reason).toContain(
      "Already has an active assignment for this job",
    );
  });

  it("ranks by simulated travel time and returns stable scores", () => {
    const riders = [makeRider("Karthik"), makeRider("Arun")];
    const { eligibleRiders } = filterEligibleRiders(riders, job);
    const now = new Date("2026-01-01T00:00:00.000Z");

    const first = rankEligibleRiders(eligibleRiders, job, now);
    const second = rankEligibleRiders(eligibleRiders, job, now);

    expect(first.map(({ riderName }) => riderName)).toEqual(["Arun", "Karthik"]);
    expect(first[0]?.estimatedTravelTime).toBeLessThan(
      first[1]?.estimatedTravelTime ?? 0,
    );
    expect(first).toEqual(second);
    expect(first[0]?.reasons).toContain("Has sufficient remaining capacity");
  });

  it("prefers lower workload when travel time and capacity are equal", () => {
    const riders = [
      makeRider("Arun", {
        id: "busy",
        assignments: [{ jobId: "another-job", status: AssignmentStatus.ACCEPTED }],
      }),
      makeRider("Arun", { id: "free" }),
    ];
    const { eligibleRiders } = filterEligibleRiders(riders, job);

    const recommendations = rankEligibleRiders(
      eligibleRiders,
      job,
      new Date("2026-01-01T00:00:00.000Z"),
    );

    expect(recommendations.map(({ riderId }) => riderId)).toEqual([
      "free",
      "busy",
    ]);
  });

  it("returns no recommendations when every rider is excluded", () => {
    const result = filterEligibleRiders(
      [makeRider("Unavailable", { isAvailable: false })],
      job,
    );

    expect(
      rankEligibleRiders(result.eligibleRiders, job, new Date()),
    ).toEqual([]);
    expect(result.excludedRiders).toHaveLength(1);
  });
});
