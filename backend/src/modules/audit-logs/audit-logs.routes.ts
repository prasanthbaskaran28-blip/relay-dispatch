import { Router } from "express";
import {
  getAuditLog,
  getAuditLogs,
  getJobAuditLogs,
} from "./audit-logs.controller.js";

const router = Router();

router.get("/", getAuditLogs);
router.get("/:eventId", getAuditLog);

export default router;
