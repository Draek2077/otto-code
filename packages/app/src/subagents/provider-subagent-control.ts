import { i18n } from "@/i18n/i18next";
import { useSessionStore } from "@/stores/session-store";

export async function controlProviderSubagent(
  serverId: string,
  parentAgentId: string,
  subagentId: string,
  action: "stop" | "archive",
  allowStopParent = false,
): Promise<void> {
  const session = useSessionStore.getState().sessions[serverId];
  if (!session?.client) throw new Error(i18n.t("subagents.daemonUnavailable"));
  // COMPAT(providerSubagentControl): added in v0.9.7, remove after 2027-03-12.
  if (!session.serverInfo?.features?.providerSubagentControl) {
    throw new Error(i18n.t("subagents.controlUnavailable"));
  }
  await session.client.controlProviderSubagent(parentAgentId, subagentId, action, allowStopParent);
}
