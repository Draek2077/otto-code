import type { IntegrationAuthorizationOverview } from "@otto-code/protocol/integration-authorization";

export function zoomTeamChatAccountLabel(
  connection: IntegrationAuthorizationOverview["connections"][number] | undefined,
): string | null {
  if (connection?.state !== "connected" || !connection.accountLabel) return null;
  return `Signed in as ${connection.accountLabel}`;
}
