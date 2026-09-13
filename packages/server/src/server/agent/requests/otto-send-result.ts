import { z } from "zod";

/** The reply a retried send must retain when Otto queues rather than starts it. */
export const OttoSendResultSchema = z.object({
  disposition: z.enum(["out_of_band", "steered", "turn_started", "queued"]),
  queuedMessageId: z.string().optional(),
});

export type OttoSendResult = z.infer<typeof OttoSendResultSchema>;
