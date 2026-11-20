import type { RequestHandler } from "express";
import { jobIdParamsSchema } from "../jobs/job.validation.js";
import { getJobRecommendations } from "./recommendation.service.js";

export const getRecommendations: RequestHandler = async (
  request,
  response,
) => {
  const { id } = jobIdParamsSchema.parse(request.params);
  const recommendations = await getJobRecommendations(id);
  response.status(200).json({ data: recommendations });
};
