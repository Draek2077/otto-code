import { useCallback, useEffect } from "react";
import { useAppSettings, type SendBehavior } from "@/hooks/use-settings";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

const pendingMigrations = new Map<string, Promise<void>>();

/**
 * Default send now has a host value because agent-to-agent sends execute with no
 * client present. Migrate an existing device choice once when a new host first
 * exposes the setting; after that the host is authoritative for its chats.
 */
export function useDefaultSendBehavior(serverId: string | null): {
  behavior: SendBehavior;
  setBehavior: (behavior: SendBehavior) => Promise<void>;
  hostSupportsAgentSends: boolean;
  isConnected: boolean;
} {
  const { settings, isLoading, updateSettings } = useAppSettings();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  // COMPAT(agentToAgentDefaultSend): added in v0.9.30, remove after 2027-04-02.
  // Older hosts keep the existing device-local composer preference.
  const hostSupportsAgentSends = useSessionStore(
    (state) =>
      (serverId
        ? state.sessions[serverId]?.serverInfo?.features?.agentToAgentDefaultSend
        : false) === true,
  );
  const hostBehavior = config?.agentBehaviors?.defaultSendBehavior;

  useEffect(() => {
    if (
      !serverId ||
      !hostSupportsAgentSends ||
      !isConnected ||
      !config ||
      hostBehavior ||
      isLoading ||
      pendingMigrations.has(serverId)
    ) {
      return;
    }
    const migration = patchConfig({
      agentBehaviors: { defaultSendBehavior: settings.sendBehavior },
    })
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error("[DefaultSend] Failed to migrate the host setting:", error);
      })
      .finally(() => pendingMigrations.delete(serverId));
    pendingMigrations.set(serverId, migration);
  }, [
    config,
    hostBehavior,
    hostSupportsAgentSends,
    isConnected,
    isLoading,
    patchConfig,
    serverId,
    settings.sendBehavior,
  ]);

  const setBehavior = useCallback(
    async (behavior: SendBehavior) => {
      if (hostSupportsAgentSends) {
        if (!isConnected) throw new Error("Host disconnected");
        if (serverId) await pendingMigrations.get(serverId);
        const updated = await patchConfig({ agentBehaviors: { defaultSendBehavior: behavior } });
        if (!updated) throw new Error("Host disconnected");
      }
      // Keep the prior device preference for old hosts and for first-connect
      // migration of another host that has never stored this choice.
      await updateSettings({ sendBehavior: behavior });
    },
    [hostSupportsAgentSends, isConnected, patchConfig, serverId, updateSettings],
  );

  return {
    behavior: hostSupportsAgentSends
      ? (hostBehavior ?? settings.sendBehavior)
      : settings.sendBehavior,
    setBehavior,
    hostSupportsAgentSends,
    isConnected,
  };
}
