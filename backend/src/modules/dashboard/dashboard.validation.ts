import { z } from "zod";

const daysInRange = 366;
const dayMilliseconds = 24 * 60 * 60 * 1000;

export const dashboardTrendsQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine(
    ({ from, to }) => {
      const today = new Date().toISOString().slice(0, 10);
      const endDate = to ?? today;
      const startDate =
        from ??
        new Date(
          Date.parse(`${endDate}T00:00:00.000Z`) - 6 * dayMilliseconds,
        )
          .toISOString()
          .slice(0, 10);
      const start = Date.parse(`${startDate}T00:00:00.000Z`);
      const end = Date.parse(`${endDate}T00:00:00.000Z`);
      return (
        start <= end &&
        end - start < daysInRange * dayMilliseconds
      );
    },
    {
      message: "'from' and 'to' must be ordered and span at most 366 days.",
    },
  );

export type DashboardTrendsQuery = z.infer<
  typeof dashboardTrendsQuerySchema
>;
