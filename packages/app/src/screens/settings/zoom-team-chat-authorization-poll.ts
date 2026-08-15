import type { IntegrationAuthorizationOverview } from "@otto-code/protocol/integration-authorization";

export function shouldPollZoomTeamChatAuthorization(
  connection: IntegrationAuthorizationOverview["connections"][number] | undefined,
  isAwaitingAuthorization: boolean,
): boolean {
  // `authorizing` is persisted so a daemon can report an interrupted OAuth
  // attempt after a restart. It is not evidence that a browser is still open.
  // Only poll while this Settings page launched the current browser flow.
  return isAwaitingAuthorization && connection?.state === "authorizing";
}
