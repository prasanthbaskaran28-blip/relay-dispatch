import { z } from "zod";

export const lifecycleJobIdParamsSchema = z.object({
  jobId: z.uuid(),
});

export const cancelJobSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
