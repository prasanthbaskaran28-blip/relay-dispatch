import { Router } from "express";
import {
  cancelJob,
  createJob,
  deliverJob,
  getJobById,
  getJobTimelineById,
  listJobs,
  pickUpJob,
  updateJob,
} from "./job.controller.js";
import { getRecommendations } from "../recommendations/recommendation.controller.js";
import {
  createAssignment,
  listJobAssignments,
  reassignJob,
} from "../assignments/assignment.controller.js";
import { getJobAuditLogs } from "../audit-logs/audit-logs.controller.js";

const router = Router();

router.route("/").get(listJobs).post(createJob);
router.post("/:jobId/assignments", createAssignment);
router.get("/:jobId/assignments", listJobAssignments);
router.post("/:jobId/reassignments", reassignJob);
router.get("/:id/recommendations", getRecommendations);
router.get("/:jobId/audit-logs", getJobAuditLogs);
router.post("/:jobId/pickup", pickUpJob);
router.post("/:jobId/deliver", deliverJob);
router.get("/:jobId/timeline", getJobTimelineById);
router.get("/:id", getJobById);
router.patch("/:id", updateJob);
router.post("/:jobId/cancel", cancelJob);

export default router;