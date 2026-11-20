import { Router } from "express";
import {
  dismissManualQueueJob,
  getManualQueueJobById,
  listManualQueue,
  retryManualQueueJob,
} from "./manual-queue.controller.js";

const router = Router();

router.get("/", listManualQueue);
router.get("/:jobId", getManualQueueJobById);
router.post("/:jobId/retry", retryManualQueueJob);
router.post("/:jobId/dismiss", dismissManualQueueJob);

export default router;
