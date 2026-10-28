import { z } from "zod";

// Keep updates partial: omitted properties must never become default values.
export const columnUpdateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    column_name: z.string().trim().min(1).optional(),
    uidt: z.string().min(1).optional(),
    dt: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    rqd: z.boolean().optional(),
    unique: z.boolean().optional(),
    un: z.boolean().optional(),
    cdf: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    np: z.number().int().nonnegative().optional(),
    ns: z.number().int().nonnegative().optional(),
    dtx: z.string().optional(),
    meta: z.record(z.unknown()).nullable().optional(),
    colOptions: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine(
    (updates) => Object.values(updates).some((value) => value !== undefined),
    "Provide at least one column property to update",
  );

export type ColumnUpdate = z.infer<typeof columnUpdateSchema>;
