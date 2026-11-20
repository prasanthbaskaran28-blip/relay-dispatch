import type { RequestHandler } from "express";
import {
  dismissManualQueueJob as dismissManualQueueJobRecord,
  getManualQueueJob,
  listManualQueue as findManualQueue,
  retryManualQueueJob as retryManualQueueJobRecord,
} from "./manual-queue.service.js";
import {
  dismissManualQueueJobSchema,
  manualQueueJobIdParamsSchema,
  manualQueueListQuerySchema,
} from "./manual-queue.validation.js";
import { idempotencyKeySchema } from "../assignments/assignment.validation.js";

export const listManualQueue: RequestHandler = async (request, response) => {
  const query = manualQueueListQuerySchema.parse(request.query);
  const result = await findManualQueue(query);
  response.status(200).json(result);
};

export const getManualQueueJobById: RequestHandler = async (
  request,
  response,
) => {
  const { jobId } = manualQueueJobIdParamsSchema.parse(request.params);
  const job = await getManualQueueJob(jobId);
  response.status(200).json({ data: job });
};

export const retryManualQueueJob: RequestHandler = async (
  request,
  response,
) => {
  const { jobId } = manualQueueJobIdParamsSchema.parse(request.params);
  const idempotencyKey = idempotencyKeySchema.parse(
    request.get("Idempotency-Key"),
  );
  const result = await retryManualQueueJobRecord(jobId, idempotencyKey);
  response.status(200).json({ data: result });
};

export const dismissManualQueueJob: RequestHandler = async (
  request,
  response,
) => {
  const { jobId } = manualQueueJobIdParamsSchema.parse(request.params);
  const { reason } = dismissManualQueueJobSchema.parse(request.body);
  const job = await dismissManualQueueJobRecord(jobId, reason);
  response.status(200).json({ data: job });
};
