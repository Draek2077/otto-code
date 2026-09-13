import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { ConnectorConfig } from "@otto-code/protocol/provider-config";
import {
  hostedConnectorVendor,
  HOSTED_CONNECTOR_DISCLOSURE,
} from "@otto-code/protocol/connector-hosted-auth";
import { useHostedConnectorFeature } from "./connectors-shared";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";
import { CONNECTOR_CATALOG } from "./connectors-catalog";
import { CONNECTOR_CONSENT_MESSAGE, signInOauthConnector } from "./connectors-oauth-sign-in";
import { connectorStyles, toErrorMessage, useConnectorOauthFeature } from "./connectors-shared";

function authorizationState(connector: ConnectorConfig) {
  const setup = CONNECTOR_CATALOG.find((entry) => entry.id === connector.id)?.setup;
  const hosted = hostedConnectorVendor(connector);
  return {
    setup,
    hosted,
    oauth:
      !connector.builtin &&
      connector.server.type !== "stdio" &&
      (setup?.kind === "oauth" || connector.auth?.kind === "oauth"),
    signedIn: hosted ? connector.auth?.hosted?.connected === true : !!connector.auth?.tokens,
    hasHostedGrant: !!connector.auth?.hosted,
  };
}

function HostedConnectionDetails({ connector }: { connector: ConnectorConfig }) {
  return (
    <>
      <Text style={settingsStyles.rowHint}>{HOSTED_CONNECTOR_DISCLOSURE}</Text>
      {connector.auth?.hosted?.connected ? (
        <Text style={settingsStyles.rowHint}>
          Account: {connector.auth.account ?? "Account label unavailable"}. Access:{" "}
          {connector.auth.hosted.scopes?.join(", ") ?? "See your vendor's consent settings"}.
        </Text>
      ) : null}
    </>
  );
}

export function OauthConnectorAuth(props: {
  serverId: string;
  connector: ConnectorConfig;
  onChanged(): void;
}) {
  const { serverId, connector, onChanged } = props;
  const client = useHostRuntimeClient(serverId);
  const supported = useConnectorOauthFeature(serverId);
  const hostedSupported = useHostedConnectorFeature(serverId);
  const { setup, hosted, oauth, signedIn, hasHostedGrant } = authorizationState(connector);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async (action: "connect" | "disconnect") => {
      if (!client) throw new Error("Host disconnected");
      setAuthorizationUrl(null);
      if (action === "disconnect") {
        await client.connectorsOauthDisconnect(connector.id);
        setMessage("Disconnected. Sign in to use these tools.");
        return;
      }
      const controller = new AbortController();
      abort.current = controller;
      setMessage("Opening your browser to sign in…");
      await signInOauthConnector(client, connector.id, {
        signal: controller.signal,
        scope: setup?.kind === "oauth" ? setup.scope : undefined,
        onWaiting: (url) => {
          setAuthorizationUrl(url);
          setMessage(CONNECTOR_CONSENT_MESSAGE);
        },
      });
      setAuthorizationUrl(null);
      setMessage("Checking the connection…");
      const verified = await client.connectorsListTools(connector.id);
      if (verified.error) throw new Error(verified.error);
      if (verified.tools.length === 0)
        throw new Error("This connector connected but exposed no tools.");
      setMessage(
        `Connected. ${verified.tools.length} tools available. Start or reload a chat to load them.`,
      );
    },
    onError: () => setMessage(null),
    onSettled: () => {
      setAuthorizationUrl(null);
      onChanged();
    },
  });
  const connect = useCallback(() => mutation.mutate("connect"), [mutation]);
  const disconnect = useCallback(() => mutation.mutate("disconnect"), [mutation]);
  const reopen = useCallback(() => {
    if (authorizationUrl)
      void openExternalUrl(authorizationUrl).catch((error: unknown) =>
        setMessage(toErrorMessage(error)),
      );
  }, [authorizationUrl]);
  if (!oauth || !supported) return null;
  return (
    <View style={connectorStyles.borderedRow} testID={`connectors-auth-${connector.id}`}>
      <View style={settingsStyles.rowContent}>
        {hosted ? <HostedConnectionDetails connector={connector} /> : null}
        {hosted && !hostedSupported ? (
          <Text style={settingsStyles.rowHint}>
            Hosted sign-in is not enabled on this host. Update the host or contact its
            administrator.
          </Text>
        ) : null}
        <Text style={settingsStyles.rowHint}>
          {message ??
            (signedIn
              ? "Signed in. Check the tools to verify access."
              : "Sign-in incomplete. Connect and approve access in your browser to use these tools.")}
        </Text>
        {mutation.isError ? (
          <Text style={settingsStyles.rowError}>{toErrorMessage(mutation.error)}</Text>
        ) : null}
      </View>
      {authorizationUrl ? (
        <Button variant="outline" size="sm" onPress={reopen}>
          Open sign-in page
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={!client || mutation.isPending || (!!hosted && !hostedSupported)}
          onPress={connect}
        >
          {signedIn ? "Reconnect" : "Connect"}
        </Button>
      )}
      {signedIn || hasHostedGrant ? (
        <Button
          variant="outline"
          size="sm"
          disabled={!client || mutation.isPending}
          onPress={disconnect}
        >
          Disconnect
        </Button>
      ) : null}
    </View>
  );
}
