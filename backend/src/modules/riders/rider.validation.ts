import { z } from "zod";

export const createRiderSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(1).max(30),
    maxCapacity: z.number().int().min(1).max(100_000),
    isAvailable: z.boolean().default(true),
  })
  .strict();

export const updateRiderSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().min(1).max(30).optional(),
    maxCapacity: z.number().int().min(1).max(100_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one editable field.",
  });

export const updateRiderAvailabilitySchema = z
  .object({
    availability: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  })
  .strict();

export const updateRiderZonesSchema = z
  .object({
    zoneIds: z.array(z.uuid()).refine((zoneIds) => new Set(zoneIds).size === zoneIds.length, {
      message: "Duplicate zone IDs are not allowed.",
    }),
  })
  .strict();

export const listRidersQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  isAvailable: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  zoneId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const riderIdParamsSchema = z.object({ id: z.uuid() });

export type CreateRiderInput = z.infer<typeof createRiderSchema>;
export type ListRidersQuery = z.infer<typeof listRidersQuerySchema>;
export type UpdateRiderAvailabilityInput = z.infer<
  typeof updateRiderAvailabilitySchema
>;
export type UpdateRiderInput = z.infer<typeof updateRiderSchema>;
export type UpdateRiderZonesInput = z.infer<typeof updateRiderZonesSchema>;
