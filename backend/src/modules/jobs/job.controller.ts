import type { RequestHandler } from "express";
import {
  createJob as createJobRecord,
  getJobById as findJobById,
  listJobs as findJobs,
  updateJob as updateJobRecord,
} from "./job.service.js";
import {
  cancelJob as cancelJobRecord,
  deliverJob as deliverJobRecord,
  getJobTimeline,
  pickUpJob as pickUpJobRecord,
} from "./job-lifecycle.service.js";
import {
  cancelJobSchema,
  lifecycleJobIdParamsSchema,
} from "./job-lifecycle.validation.js";
import {
  createJobSchema,
  jobIdParamsSchema,
  listJobsQuerySchema,
  updateJobSchema,
} from "./job.validation.js";

export const createJob: RequestHandler = async (request, response) => {
  const input = createJobSchema.parse(request.body);
  const result = await createJobRecord(input);
  response.status(result.replayed ? 200 : 201).json({ data: result.job });
};

export const listJobs: RequestHandler = async (request, response) => {
  const query = listJobsQuerySchema.parse(request.query);
  const result = await findJobs(query);
  response.status(200).json(result);
};

export const getJobById: RequestHandler = async (request, response) => {
  const { id } = jobIdParamsSchema.parse(request.params);
  const job = await findJobById(id);
  response.status(200).json({ data: job });
};

export const updateJob: RequestHandler = async (request, response) => {
  const { id } = jobIdParamsSchema.parse(request.params);
  const input = updateJobSchema.parse(request.body);
  const job = await updateJobRecord(id, input);
  response.status(200).json({ data: job });
};

export const cancelJob: RequestHandler = async (request, response) => {
  const { jobId } = lifecycleJobIdParamsSchema.parse(request.params);
  const { reason } = cancelJobSchema.parse(request.body);
  const job = await cancelJobRecord(jobId, reason);
  response.status(200).json({ data: job });
};

export const pickUpJob: RequestHandler = async (request, response) => {
  const { jobId } = lifecycleJobIdParamsSchema.parse(request.params);
  const job = await pickUpJobRecord(jobId);
  response.status(200).json({ data: job });
};

export const deliverJob: RequestHandler = async (request, response) => {
  const { jobId } = lifecycleJobIdParamsSchema.parse(request.params);
  const job = await deliverJobRecord(jobId);
  response.status(200).json({ data: job });
};

export const getJobTimelineById: RequestHandler = async (
  request,
  response,
) => {
  const { jobId } = lifecycleJobIdParamsSchema.parse(request.params);
  const timeline = await getJobTimeline(jobId);
  response.status(200).json({ data: timeline });
};