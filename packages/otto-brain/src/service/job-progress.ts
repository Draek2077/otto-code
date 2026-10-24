/** Public progress carries measured fields, never a nested native exception. */
import type { BrainJobContext, JobValue } from "./jobs.js";

export function publishJobProgress(context: BrainJobContext, event: object): void {
  const safe: { [key: string]: JobValue } = {};
  const failed = "phase" in event && event.phase === "failed";
  for (const [key, value] of Object.entries(event)) {
    if (key === "error" || key === "reason" || key === "detail") continue;
    if (typeof value === "string") {
      safe[key] = failed && key === "summary" ? "Brain benchmark task failed" : value.slice(0, 256);
      continue;
    }
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      safe[key] = value;
  }
  context.progress(safe);
}
