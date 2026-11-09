import { z } from "zod";

const info = z
  .object({
    status: z.literal("server_info"),
    features: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const envelope = z
  .object({
    message: z.object({ payload: info }).passthrough().optional(),
    payload: info.optional(),
  })
  .passthrough();

/** Compatibility fixture only: retain the real native RPCs and every other
 * capability while presenting the pre-extension server_info contract. */
export function nativeScheduleCapabilityFloor(message: string | Buffer) {
  const unchanged = { message, serverInfo: false };
  if (typeof message !== "string") return unchanged;
  let json: unknown;
  try {
    json = JSON.parse(message);
  } catch {
    return unchanged;
  }
  const parsed = envelope.safeParse(json);
  if (!parsed.success) return unchanged;
  const payload = parsed.data.message?.payload ?? parsed.data.payload;
  if (!payload) return unchanged;
  if (!payload.features || !Object.hasOwn(payload.features, "scheduleTargets"))
    return { message, serverInfo: true };
  delete payload.features.scheduleTargets;
  return { message: JSON.stringify(parsed.data), serverInfo: true };
}
