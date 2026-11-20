import { z } from "zod";

const dateTimeSchema = z
  .iso.datetime({ offset: true })
  .transform((value) => new Date(value));

export const auditEventIdParamsSchema = z.object({
  eventId: z.uuid(),
});

export const auditJobIdParamsSchema = z.object({
  jobId: z.uuid(),
});

export const auditLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    eventType: z.string().trim().min(1).max(100).optional(),
    entityType: z.enum(["JOB", "ASSIGNMENT"]).optional(),
    actor: z.string().trim().min(1).max(100).optional(),
    from: dateTimeSchema.optional(),
    to: dateTimeSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .refine(
    ({ from, to }) => !from || !to || from.getTime() <= to.getTime(),
    { message: "'from' must be earlier than or equal to 'to'." },
  );

export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;
