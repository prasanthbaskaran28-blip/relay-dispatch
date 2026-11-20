import { Router } from "express";
import {
  getDashboardOverviewHandler,
  getDashboardTrendsHandler,
  getZonePerformanceHandler,
} from "./dashboard.controller.js";

const router = Router();

router.get("/overview", getDashboardOverviewHandler);
router.get("/trends", getDashboardTrendsHandler);
router.get("/zone-performance", getZonePerformanceHandler);

export default router;
