/** Only report presentation crosses the owner boundary, never archived raw configuration. */
import { z } from "zod/v3";
const Text = z.string().max(8192);
export const ReportExportOptionsSchema = z
  .object({ out: z.string().min(1).max(4096).optional() })
  .strict();
export const ReportOutputSchema = z.object({
  file: Text,
  count: z.number().int().nonnegative(),
  columns: z.array(z.object({ id: Text, category: Text })).max(1000),
  models: z
    .array(
      z.object({
        id: Text.nullable(),
        displayName: Text,
        overall: z.number().finite(),
        tasks: z
          .array(z.object({ id: Text, category: Text, score: z.number().finite() }))
          .max(1000),
      }),
    )
    .max(10000),
});
export type ReportOutput = z.infer<typeof ReportOutputSchema>;
export const ReportExportReplySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), report: ReportOutputSchema }),
  z.object({ ok: z.literal(false), code: z.literal("NO_RESULTS") }),
]);
