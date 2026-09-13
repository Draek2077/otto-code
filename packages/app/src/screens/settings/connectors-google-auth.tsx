import { useCallback, useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import {
  googleConnectorForConfig,
  type ConnectorConfig,
} from "@otto-code/protocol/provider-config";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import {
  GOOGLE_CONNECTOR_INTEGRATION_ID,
  signInGoogleConnector,
} from "./connectors-google-sign-in";
import { connectorStyles, toErrorMessage, useGoogleConnectorFeature } from "./connectors-shared";

export function GoogleConnectorAuth(props: {
  serverId: string;
  connector: ConnectorConfig;
  onChanged(): void;
}) {
  const { serverId, connector, onChanged } = props;
  const client = useHostRuntimeClient(serverId);
  const supported = useGoogleConnectorFeature(serverId);
  const native = !!googleConnectorForConfig(connector);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const overview = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 10_000,
    queryKey: ["connector-authorization", serverId, connector.id],
    enabled: !!client && supported && native,
    queryFn: async () => client!.integrationsAuthorizationGetOverview(),
  });
  const connection = overview.data?.connections.find(
    (entry) =>
      entry.integrationId === GOOGLE_CONNECTOR_INTEGRATION_ID &&
      entry.connectionId === connector.id,
  );
  const mutation = useMutation({
    mutationFn: async (action: "connect" | "disconnect") => {
      if (!client) throw new Error("Host disconnected");
      abort.current?.abort();
      if (action === "disconnect") {
        await client.connectorsOauthDisconnect(connector.id);
        return "Disconnected";
      }
      const controller = new AbortController();
      abort.current = controller;
      await signInGoogleConnector(client, connector.id, controller.signal);
      const verified = await client.connectorsListTools(connector.id);
      if (verified.error) throw new Error(verified.error);
      if (verified.tools.length === 0) throw new Error("Google connected but exposed no tools.");
      return `Connected. ${verified.tools.length} tools available. Start or reload a chat to load them.`;
    },
    onSettled: () => {
      void overview.refetch();
      onChanged();
    },
  });
  const connect = useCallback(() => mutation.mutate("connect"), [mutation]);
  const disconnect = useCallback(() => mutation.mutate("disconnect"), [mutation]);
  if (!native) return null;
  if (!supported)
    return (
      <Text style={settingsStyles.rowHint}>Google sign-in is unavailable in this host build.</Text>
    );
  const signedIn = connection?.state === "connected";
  let connectLabel = signedIn ? "Reconnect" : "Connect";
  if (mutation.isPending || connection?.state === "authorizing") connectLabel = "Start again";
  return (
    <View style={connectorStyles.borderedRow}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowHint}>
          {mutation.isPending
            ? "Connecting…"
            : (mutation.data ?? connection?.accountLabel ?? "Sign in to use these tools.")}
        </Text>
        {mutation.isError ? (
          <Text style={settingsStyles.rowError}>{toErrorMessage(mutation.error)}</Text>
        ) : null}
      </View>
      <Button variant="outline" size="sm" onPress={connect}>
        {connectLabel}
      </Button>
      {signedIn ? (
        <Button variant="outline" size="sm" disabled={mutation.isPending} onPress={disconnect}>
          Disconnect
        </Button>
      ) : null}
    </View>
  );
}
