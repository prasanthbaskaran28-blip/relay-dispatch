import type { RequestHandler } from "express";
import {
  getAuditLogById,
  listAuditLogs,
  listJobAuditLogs,
} from "./audit-logs.service.js";
import {
  auditEventIdParamsSchema,
  auditJobIdParamsSchema,
  auditLogsQuerySchema,
} from "./audit-logs.validation.js";

export const getAuditLogs: RequestHandler = async (request, response) => {
  const query = auditLogsQuerySchema.parse(request.query);
  const result = await listAuditLogs(query);
  response.status(200).json(result);
};

export const getAuditLog: RequestHandler = async (request, response) => {
  const { eventId } = auditEventIdParamsSchema.parse(request.params);
  const event = await getAuditLogById(eventId);
  response.status(200).json({ data: event });
};

export const getJobAuditLogs: RequestHandler = async (request, response) => {
  const { jobId } = auditJobIdParamsSchema.parse(request.params);
  const events = await listJobAuditLogs(jobId);
  response.status(200).json({ data: events });
};
