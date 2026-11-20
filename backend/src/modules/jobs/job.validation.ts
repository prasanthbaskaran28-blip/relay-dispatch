import { JobPriority, JobStatus } from "@prisma/client";
import { z } from "zod";

const deadlineSchema = z
  .iso.datetime({ offset: true })
  .transform((value) => new Date(value));

export const createJobSchema = z
  .object({
    orderReference: z.string().trim().min(1).max(100),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
    pickupZoneId: z.uuid(),
    deliveryZoneId: z.uuid(),
    requiredCapacity: z.number().int().min(1).max(100_000),
    priority: z.nativeEnum(JobPriority).optional(),
    deadline: deadlineSchema.nullable().optional(),
  })
  .strict();

export const updateJobSchema = z
  .object({
    pickupZoneId: z.uuid().optional(),
    deliveryZoneId: z.uuid().optional(),
    requiredCapacity: z.number().int().min(1).max(100_000).optional(),
    priority: z.nativeEnum(JobPriority).optional(),
    deadline: deadlineSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one editable field.",
  });

export const listJobsQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.nativeEnum(JobStatus).optional(),
  priority: z.nativeEnum(JobPriority).optional(),
  pickupZoneId: z.uuid().optional(),
  deliveryZoneId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const jobIdParamsSchema = z.object({ id: z.uuid() });

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type UpdateJobInput = z.infer<typeof updateJobSchema>;
export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;