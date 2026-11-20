import apiClient from "./apiClient";
import type {
  ApiData,
  DashboardOverview,
  DashboardTrends,
  ZonePerformance,
} from "../types/api";

export async function fetchDashboardOverview() {
  const { data } = await apiClient.get<ApiData<DashboardOverview>>("/dashboard/overview");
  return data.data;
}

export async function fetchDashboardTrends(from: string, to: string) {
  const { data } = await apiClient.get<ApiData<DashboardTrends>>("/dashboard/trends", {
    params: { from, to },
  });
  return data.data;
}

export async function fetchZonePerformance() {
  const { data } = await apiClient.get<ApiData<ZonePerformance[]>>(
    "/dashboard/zone-performance",
  );
  return data.data;
}
