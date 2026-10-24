import { z } from "zod/v3";
export const RescoreOptionsSchema = z
  .object({ run: z.string().min(1).max(1024).optional(), execute: z.boolean().optional() })
  .strict();
export const RescoreRowsSchema = z
  .array(
    z.object({
      archiveId: z.string().max(1024),
      changed: z.number().int().nonnegative(),
      tasks: z
        .array(
          z.object({
            taskId: z.string().max(1024),
            before: z.number().finite().nullable(),
            score: z.number().finite().nullable(),
            changed: z.boolean(),
            summary: z.string().max(8192),
          }),
        )
        .max(1000),
    }),
  )
  .max(10000);
export type RescoreRow = z.infer<typeof RescoreRowsSchema>[number];
export const RescoreAdmissionSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), job: z.object({ id: z.string().min(1).max(1024) }) }),
  z.object({ ok: z.literal(false), code: z.enum(["NO_ARCHIVE", "UNKNOWN_RUN"]) }),
]);
