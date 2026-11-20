import { z } from "zod";

const optionalReasonSchema = z.string().trim().min(1).max(500).optional();

export const jobIdParamsSchema = z.object({ jobId: z.uuid() });
export const assignmentIdParamsSchema = z.object({ assignmentId: z.uuid() });

export const createAssignmentSchema = z
  .object({
    riderId: z.uuid(),
    overrideReason: optionalReasonSchema,
  })
  .strict();

export const createReassignmentSchema = z
  .object({
    assignmentId: z.uuid(),
    riderId: z.uuid(),
    reassignmentReason: optionalReasonSchema,
    overrideReason: optionalReasonSchema,
  })
  .strict();

export const rejectAssignmentSchema = z
  .object({
    rejectionReason: z.string().trim().min(1).max(500),
  })
  .strict();

export const idempotencyKeySchema = z.string().trim().min(1).max(128);

export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type CreateReassignmentInput = z.infer<
  typeof createReassignmentSchema
>;
