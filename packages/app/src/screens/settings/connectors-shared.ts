// Plumbing shared by the two Connectors surfaces: the settings section (what
// you have added, and whether it is on) and the add sheet (what you could add).
// Anything used by only one of them stays in that file.
//
// i18n: English-only pending a translation pass (build-first, translate-last).
import { useMutation } from "@tanstack/react-query";
import { StyleSheet } from "react-native-unistyles";
import type { MutableDaemonConfigPatch } from "@otto-code/protocol/messages";
import {
  googleConnectorForConfig,
  type ConnectorConfig,
} from "@otto-code/protocol/provider-config";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSessionStore } from "@/stores/session-store";

/**
 * The single detection point for the connectors capability.
 * COMPAT(connectors): added in v0.7.5, drop the gate when daemon floor >= v0.7.5.
 */
export function useConnectorsFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.connectors === true,
  );
}

/**
 * Whether this host can run a connector's OAuth login.
 * COMPAT(connectorOauth): added in v0.7.7, drop the gate when daemon floor >= v0.7.7.
 */
export function useConnectorOauthFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.connectorOauth === true,
  );
}

/** COMPAT(connectorNativeGoogle): added in v0.9.9, remove after 2027-03-12. */
export function useGoogleConnectorFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.connectorNativeGoogle === true,
  );
}

/** COMPAT(connectorHostedOauth): added in v0.9.11, remove after 2027-03-13. */
export function useHostedConnectorFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.connectorHostedOauth === true,
  );
}

export function toErrorMessage(error: unknown): string | null {
  if (!error) {
    return null;
  }
  return error instanceof Error ? error.message : String(error);
}

export function transportSummary(connector: ConnectorConfig): string {
  if (googleConnectorForConfig(connector)) return "Google account";
  const server = connector.server;
  return server.type === "stdio" ? `stdio · ${server.command}` : `${server.type} · ${server.url}`;
}

export function usePatchMutation(serverId: string) {
  const { patchConfig } = useDaemonConfig(serverId);
  return useMutation({
    mutationFn: async (patch: MutableDaemonConfigPatch) => {
      const result = await patchConfig(patch);
      if (!result) {
        throw new Error("Host disconnected");
      }
      return result;
    },
  });
}

// Form chrome both surfaces render: a labelled row with its control on the
// right (stacking on the narrowest widths) and the text inputs that sit in it.
export const connectorStyles = StyleSheet.create((theme) => ({
  borderedRow: {
    flexDirection: { xs: "column", sm: "row" },
    alignItems: "center",
    justifyContent: "space-between",
    gap: { xs: theme.spacing[3], sm: theme.spacing[3] },
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    width: { xs: "100%", sm: "auto" },
    maxWidth: 280,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "left",
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
}));
