import { JobPriority } from "@prisma/client";
import { z } from "zod";

export const manualQueueJobIdParamsSchema = z.object({
  jobId: z.uuid(),
});

export const manualQueueListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  priority: z.nativeEnum(JobPriority).optional(),
  pickupZoneId: z.uuid().optional(),
  deliveryZoneId: z.uuid().optional(),
  date: z.iso.date().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

export const dismissManualQueueJobSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type ManualQueueListQuery = z.infer<
  typeof manualQueueListQuerySchema
>;
