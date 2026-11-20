import { Router } from "express";
import {
  acceptAssignment,
  getAssignment,
  rejectAssignment,
} from "./assignment.controller.js";

const router = Router();

router.post("/:assignmentId/accept", acceptAssignment);
router.post("/:assignmentId/reject", rejectAssignment);
router.get("/:assignmentId", getAssignment);

export default router;
