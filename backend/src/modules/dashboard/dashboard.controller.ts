import type { RequestHandler } from "express";
import {
  getDashboardOverview,
  getDashboardTrends,
  getZonePerformance,
} from "./dashboard.service.js";
import { dashboardTrendsQuerySchema } from "./dashboard.validation.js";

export const getDashboardOverviewHandler: RequestHandler = async (
  _request,
  response,
) => {
  const overview = await getDashboardOverview();
  response.status(200).json({ data: overview });
};

export const getDashboardTrendsHandler: RequestHandler = async (
  request,
  response,
) => {
  const query = dashboardTrendsQuerySchema.parse(request.query);
  const trends = await getDashboardTrends(query);
  response.status(200).json({ data: trends });
};

export const getZonePerformanceHandler: RequestHandler = async (
  _request,
  response,
) => {
  const performance = await getZonePerformance();
  response.status(200).json({ data: performance });
};
