import { z } from "zod";

// Provider-reported plan rate-limit status (e.g. Claude claude.ai plan
// windows), pushed on the agent stream when it changes. Presentation-only:
// the app decides whether to show it (rateLimitWarningsEnabled setting).
export const AgentRateLimitInfoSchema = z.object({
  status: z.enum(["allowed", "warning", "rejected"]),
  // Percentage of the limit window used, 0-100. Absent when the provider
  // does not report it (Claude only includes it near the limit).
  utilizationPercent: z.number().optional(),
  // Provider-reported window identifier, e.g. "five_hour" | "seven_day".
  // Open set - display code falls back to a generic label for unknown values.
  limitType: z.string().optional(),
  // ISO 8601 timestamp when the window resets.
  resetsAt: z.string().optional(),
  // True when usage is currently drawing from overage/extra usage credits.
  isUsingOverage: z.boolean().optional(),
});
