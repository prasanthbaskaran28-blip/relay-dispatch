import { JobPriority } from "@prisma/client";

export const recommendationWeights: Record<
  JobPriority,
  { workload: number; travelTime: number; capacityFit: number; deadline: number }
> = {
  [JobPriority.LOW]: {
    workload: 40,
    travelTime: 25,
    capacityFit: 20,
    deadline: 15,
  },
  [JobPriority.NORMAL]: {
    workload: 35,
    travelTime: 30,
    capacityFit: 20,
    deadline: 15,
  },
  [JobPriority.HIGH]: {
    workload: 30,
    travelTime: 30,
    capacityFit: 15,
    deadline: 25,
  },
  [JobPriority.URGENT]: {
    workload: 25,
    travelTime: 30,
    capacityFit: 10,
    deadline: 35,
  },
};

const simulatedStartZones: Record<string, string> = {
  Arun: "Chennai Central",
  Karthik: "Tambaram",
  Rahul: "Velachery",
  Suresh: "Anna Nagar",
  Vignesh: "Guindy",
};

const simulatedTravelTimes: Record<string, number> = {
  "Anna Nagar|Chennai Central": 18,
  "Anna Nagar|Guindy": 22,
  "Anna Nagar|Tambaram": 38,
  "Anna Nagar|Velachery": 32,
  "Chennai Central|Guindy": 15,
  "Chennai Central|Tambaram": 34,
  "Chennai Central|Velachery": 28,
  "Guindy|Tambaram": 25,
  "Guindy|Velachery": 18,
  "Tambaram|Velachery": 20,
};

export function getSimulatedTravelTime(fromZone: string, toZone: string): number {
  if (fromZone === toZone) return 0;
  const key = [fromZone, toZone].sort((a, b) => a.localeCompare(b)).join("|");
  return simulatedTravelTimes[key] ?? 30;
}

export function estimateRiderTravelTime(
  riderName: string,
  pickupZone: string,
  deliveryZone: string,
): number {
  const startZone = simulatedStartZones[riderName] ?? pickupZone;
  return (
    getSimulatedTravelTime(startZone, pickupZone) +
    getSimulatedTravelTime(pickupZone, deliveryZone)
  );
}
