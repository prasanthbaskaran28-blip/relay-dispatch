import { useCallback, useEffect, useState } from "react";
import { getApiError } from "../services/apiClient";
import {
  fetchDashboardOverview,
  fetchDashboardTrends,
  fetchZonePerformance,
} from "../services/dashboardService";
import type { DashboardOverview, DashboardTrends, ZonePerformance } from "../types/api";

export function useDashboardData(from: string, to: string) {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [trends, setTrends] = useState<DashboardTrends | null>(null);
  const [zones, setZones] = useState<ZonePerformance[] | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [zonesError, setZonesError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [trendsRefreshKey, setTrendsRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setOverviewLoading(true);
    setOverviewError(null);
    void fetchDashboardOverview()
      .then((result) => {
        if (active) setOverview(result);
      })
      .catch((requestError: unknown) => {
        if (active) setOverviewError(getApiError(requestError).message);
      })
      .finally(() => {
        if (active) setOverviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    let active = true;
    setZonesLoading(true);
    setZonesError(null);
    void fetchZonePerformance()
      .then((result) => {
        if (active) setZones(result);
      })
      .catch((requestError: unknown) => {
        if (active) setZonesError(getApiError(requestError).message);
      })
      .finally(() => {
        if (active) setZonesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    let active = true;
    setTrendsLoading(true);
    setTrendsError(null);
    void fetchDashboardTrends(from, to)
      .then((result) => {
        if (active) setTrends(result);
      })
      .catch((requestError: unknown) => {
        if (active) setTrendsError(getApiError(requestError).message);
      })
      .finally(() => {
        if (active) setTrendsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [from, to, refreshKey, trendsRefreshKey]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const refreshTrends = useCallback(
    () => setTrendsRefreshKey((key) => key + 1),
    [],
  );

  return {
    overview,
    trends,
    zones,
    overviewError,
    trendsError,
    zonesError,
    overviewLoading,
    trendsLoading,
    zonesLoading,
    refresh,
    refreshTrends,
  };
}
