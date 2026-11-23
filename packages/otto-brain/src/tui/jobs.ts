/** Only known progress fields enter terminal presentation. Raw job results stay on the owner. */
import { z } from "zod/v3";
import type { TuiJob } from "./host.js";
export const TuiJobInputSchema = z.object({
  id: z.string(),
  benchmarkMode: z.literal("rescore").optional(),
  operation: z.enum([
    "calibrate",
    "sweep",
    "benchmark",
    "pull",
    "runtime-install",
    "runtime-remove",
  ]),
  subject: z.object({ modelId: z.string().nullable() }),
  state: z.enum(["queued", "running", "completed", "failed", "canceled"]),
  progress: z.unknown(),
  error: z.string().nullable(),
});
const Progress = z.object({
  phase: z.string().max(8192).optional(),
  summary: z.string().max(8192).optional(),
  message: z.string().max(8192).optional(),
  receivedBytes: z.number().nullable().optional(),
  totalBytes: z.number().nullable().optional(),
  percent: z.number().nullable().optional(),
});
export function tuiJob(job: z.infer<typeof TuiJobInputSchema>): TuiJob {
  const value = Progress.safeParse(job.progress);
  const progress = value.success
    ? [value.data.phase, value.data.summary, value.data.message]
        .filter((line): line is string => Boolean(line))
        .slice(-3)
    : [];
  if (job.benchmarkMode === "rescore") progress.unshift("Rescore saved benchmark");
  let fraction: number | null = null;
  if (value.success) {
    const { receivedBytes, totalBytes, percent } = value.data;
    if (typeof percent === "number") fraction = Math.max(0, Math.min(1, percent / 100));
    else if (typeof receivedBytes === "number" && typeof totalBytes === "number" && totalBytes > 0)
      fraction = Math.max(0, Math.min(1, receivedBytes / totalBytes));
  }
  let operation: TuiJob["operation"] = "runtime";
  if (job.operation === "benchmark") operation = "bench";
  else if (job.operation === "calibrate" || job.operation === "sweep" || job.operation === "pull")
    operation = job.operation;
  return {
    id: job.id,
    operation,
    modelId: job.subject.modelId,
    state: job.state,
    progress,
    fraction,
    error: job.error,
    cancelable: job.state === "queued" || job.state === "running",
  };
}
