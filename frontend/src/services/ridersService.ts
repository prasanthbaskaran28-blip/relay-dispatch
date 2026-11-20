import apiClient from "./apiClient";
import { fetchZonePerformance } from "./dashboardService";
import type {
  ApiData,
  PaginatedResponse,
  Rider,
  ZonePerformance,
} from "../types/api";

export interface RiderQuery {
  q?: string;
  isAvailable?: boolean;
  zoneId?: string;
  page: number;
  pageSize: number;
}

export interface RiderInput {
  name: string;
  phone: string;
  maxCapacity: number;
  isAvailable?: boolean;
}

export interface RiderZone {
  id: string;
  name: string;
}

export async function fetchRiders(query: RiderQuery) {
  const { data } = await apiClient.get<PaginatedResponse<Rider>>("/riders", {
    params: query,
  });
  return data;
}

export async function fetchZones(): Promise<RiderZone[]> {
  const zones: ZonePerformance[] = await fetchZonePerformance();
  return zones.map(({ zoneId, zoneName }) => ({ id: zoneId, name: zoneName }));
}

export async function fetchRider(id: string) {
  const { data } = await apiClient.get<ApiData<Rider>>(`/riders/${id}`);
  return data.data;
}

export async function createRider(input: RiderInput) {
  const { data } = await apiClient.post<ApiData<Rider>>("/riders", input);
  return data.data;
}

export async function updateRider(id: string, input: Partial<RiderInput>) {
  const { data } = await apiClient.patch<ApiData<Rider>>(`/riders/${id}`, input);
  return data.data;
}

export async function updateRiderZones(id: string, zoneIds: string[]) {
  const { data } = await apiClient.patch<ApiData<Rider>>(`/riders/${id}/zones`, {
    zoneIds,
  });
  return data.data;
}

export async function updateRiderAvailability(
  id: string,
  availability: "AVAILABLE" | "UNAVAILABLE",
) {
  const { data } = await apiClient.patch<ApiData<Rider>>(
    `/riders/${id}/availability`,
    { availability },
  );
  return data.data;
}
