import type { CheckoutStatusResponse } from "@otto-code/protocol/messages";

/**
 * The status handler still encodes a failed measurement as isGit:false + error.
 * Only an error-free non-repository result can replace known Git state; rejecting
 * a fetch leaves query retry/reconnect recovery with the canonical query owner.
 */
export function isFailedCheckoutMeasurement(payload: CheckoutStatusResponse["payload"]): boolean {
  return payload.error != null;
}
