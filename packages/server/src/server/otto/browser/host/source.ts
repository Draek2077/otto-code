import type { SessionDelivery } from "../../../session/owned-subscriptions/index.js";
import type { HostBrowserSource } from "./views.js";
/** Created by the authenticated Session, never from plugin input or a reusable client ID. */
export function hostBrowserRequestSource(delivery: SessionDelivery): HostBrowserSource | undefined {
  const source = delivery.currentSource;
  if (!source || !delivery.isModern(source)) return undefined;
  return { source, retainBinary: (stop) => delivery.binaryOperation(stop) };
}
