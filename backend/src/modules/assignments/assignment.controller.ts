import type { RequestHandler } from "express";
import {
  createAssignment as createAssignmentRecord,
  acceptAssignment as acceptAssignmentRecord,
  getAssignmentById,
  getJobAssignmentHistory,
  rejectAssignment as rejectAssignmentRecord,
  reassignJob as reassignJobRecord,
} from "./assignment.service.js";
import {
  createAssignmentSchema,
  createReassignmentSchema,
  assignmentIdParamsSchema,
  idempotencyKeySchema,
  jobIdParamsSchema,
  rejectAssignmentSchema,
} from "./assignment.validation.js";

export const acceptAssignment: RequestHandler = async (request, response) => {
  const { assignmentId } = assignmentIdParamsSchema.parse(request.params);
  const assignment = await acceptAssignmentRecord(assignmentId);
  response.status(200).json({ data: assignment });
};

export const rejectAssignment: RequestHandler = async (request, response) => {
  const { assignmentId } = assignmentIdParamsSchema.parse(request.params);
  const { rejectionReason } = rejectAssignmentSchema.parse(request.body);
  const assignment = await rejectAssignmentRecord(
    assignmentId,
    rejectionReason,
  );
  response.status(200).json({ data: assignment });
};

export const createAssignment: RequestHandler = async (
  request,
  response,
) => {
  const { jobId } = jobIdParamsSchema.parse(request.params);
  const input = createAssignmentSchema.parse(request.body);
  const idempotencyKey = idempotencyKeySchema.parse(
    request.get("Idempotency-Key"),
  );
  const result = await createAssignmentRecord(jobId, input, idempotencyKey);
  response.status(result.replayed ? 200 : 201).json({ data: result.assignment });
};

export const reassignJob: RequestHandler = async (request, response) => {
  const { jobId } = jobIdParamsSchema.parse(request.params);
  const input = createReassignmentSchema.parse(request.body);
  const idempotencyKey = idempotencyKeySchema.parse(
    request.get("Idempotency-Key"),
  );
  const result = await reassignJobRecord(jobId, input, idempotencyKey);
  response.status(result.replayed ? 200 : 201).json({ data: result.assignment });
};

export const listJobAssignments: RequestHandler = async (
  request,
  response,
) => {
  const { jobId } = jobIdParamsSchema.parse(request.params);
  const assignments = await getJobAssignmentHistory(jobId);
  response.status(200).json({ data: assignments });
};

export const getAssignment: RequestHandler = async (request, response) => {
  const { assignmentId } = assignmentIdParamsSchema.parse(request.params);
  const assignment = await getAssignmentById(assignmentId);
  response.status(200).json({ data: assignment });
};
