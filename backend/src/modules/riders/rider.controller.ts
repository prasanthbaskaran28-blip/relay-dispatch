import type { RequestHandler } from "express";
import {
  createRider as createRiderRecord,
  getRiderById as findRiderById,
  listRiders as findRiders,
  updateRiderAvailability as updateRiderAvailabilityRecord,
  updateRider as updateRiderRecord,
  updateRiderZones as updateRiderZonesRecord,
} from "./rider.service.js";
import {
  createRiderSchema,
  listRidersQuerySchema,
  riderIdParamsSchema,
  updateRiderAvailabilitySchema,
  updateRiderSchema,
  updateRiderZonesSchema,
} from "./rider.validation.js";

export const createRider: RequestHandler = async (request, response) => {
  const input = createRiderSchema.parse(request.body);
  const rider = await createRiderRecord(input);
  response.status(201).json({ data: rider });
};

export const listRiders: RequestHandler = async (request, response) => {
  const query = listRidersQuerySchema.parse(request.query);
  const result = await findRiders(query);
  response.status(200).json(result);
};

export const getRiderById: RequestHandler = async (request, response) => {
  const { id } = riderIdParamsSchema.parse(request.params);
  const rider = await findRiderById(id);
  response.status(200).json({ data: rider });
};

export const updateRider: RequestHandler = async (request, response) => {
  const { id } = riderIdParamsSchema.parse(request.params);
  const input = updateRiderSchema.parse(request.body);
  const rider = await updateRiderRecord(id, input);
  response.status(200).json({ data: rider });
};

export const updateRiderAvailability: RequestHandler = async (
  request,
  response,
) => {
  const { id } = riderIdParamsSchema.parse(request.params);
  const input = updateRiderAvailabilitySchema.parse(request.body);
  const rider = await updateRiderAvailabilityRecord(id, input);
  response.status(200).json({ data: rider });
};

export const updateRiderZones: RequestHandler = async (request, response) => {
  const { id } = riderIdParamsSchema.parse(request.params);
  const input = updateRiderZonesSchema.parse(request.body);
  const rider = await updateRiderZonesRecord(id, input);
  response.status(200).json({ data: rider });
};
