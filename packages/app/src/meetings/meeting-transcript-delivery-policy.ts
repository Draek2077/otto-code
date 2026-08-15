import type { ActiveConnection } from "@/runtime/host-runtime";
import type { MeetingTranscriptDeliveryPolicy } from "@/hooks/use-settings/storage";

export type MeetingTranscriptDeliveryDestination = "local" | "daemon";

export function resolveMeetingTranscriptDeliveryDestination(input: {
  policy: MeetingTranscriptDeliveryPolicy;
  activeConnection: ActiveConnection | null;
  daemonAvailable: boolean;
}): MeetingTranscriptDeliveryDestination {
  if (input.policy === "local_only") return "local";
  if (!input.daemonAvailable) return "local";
  if (input.policy === "current_connection") return "daemon";
  return input.activeConnection?.encrypted === true ? "daemon" : "local";
}

export function localTranscriptDeliveryStateForPolicy(
  policy: MeetingTranscriptDeliveryPolicy,
): "local_only" | "waiting_for_secure_connection" {
  return policy === "local_only" ? "local_only" : "waiting_for_secure_connection";
}
