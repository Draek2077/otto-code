// Connectors settings - daemon-wide MCP servers surfaced as named, toggle-able
// integrations. This section is the ledger of what you have added and whether
// it is on: one card per connector, a global enable switch, and an expandable
// list of its tools with per-tool disable.
//
// Browsing and adding live in AddConnectorSheet (a dialog on desktop, a bottom
// sheet on mobile) rather than inline, so the full catalog never buries the
// handful of connectors you actually run.
//
// Mirrors the toggle mechanics of otto-tools-section and the per-entry card
// layout of git-providers-settings-cards. Enforcement lives in the daemon; this
// is the control surface.
//
// i18n: English-only pending a translation pass (build-first, translate-last).
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { StyleSheet } from "react-native-unistyles";
import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import type { ConnectorConfig } from "@otto-code/protocol/provider-config";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { AddConnectorSheet } from "./connectors-add-sheet";
import {
  createRemoveConnectorPatch,
  createSetConnectorEnabledPatch,
  createSetConnectorToolDisabledPatch,
  getConnectors,
  isConnectorEnabled,
  isConnectorToolDisabled,
} from "./connectors-config";
import {
  connectorStyles,
  toErrorMessage,
  transportSummary,
  useConnectorsFeature,
  usePatchMutation,
} from "./connectors-shared";

export { useConnectorOauthFeature, useConnectorsFeature } from "./connectors-shared";

// Stable empty reference so a connector with no fetched tools yet doesn't hand a
// fresh array literal down as a prop on every render.
const NO_TOOLS: { name: string; description: string | null }[] = [];

// One tool row inside a connector's expanded body: enabled unless the connector
// lists it in disabledTools. The switch value is "enabled", so it inverts the
// stored disabled flag.
function ConnectorToolRow(props: {
  serverId: string;
  config: MutableDaemonConfig | null;
  connector: ConnectorConfig;
  toolName: string;
  description: string | null;
}) {
  const { serverId, config, connector, toolName, description } = props;
  const mutation = usePatchMutation(serverId);
  const enabled = !isConnectorToolDisabled(connector, toolName);
  const onValueChange = useCallback(
    (next: boolean) => {
      mutation.mutate(createSetConnectorToolDisabledPatch(config, connector.id, toolName, !next));
    },
    [mutation, config, connector.id, toolName],
  );
  return (
    <View style={styles.toolRow} testID={`connectors-tool-${connector.id}-${toolName}`}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{toolName}</Text>
        {description ? <Text style={settingsStyles.rowHint}>{description}</Text> : null}
      </View>
      <Switch
        value={enabled}
        onValueChange={onValueChange}
        disabled={mutation.isPending || !isConnectorEnabled(connector)}
        accessibilityLabel={`Enable ${toolName}`}
        testID={`connectors-tool-${connector.id}-${toolName}-switch`}
      />
    </View>
  );
}

// The expanded tool list: loading / error / empty / rows, as if-else returns so
// there is no nested ternary in the card's JSX.
function ConnectorToolsBody(props: {
  serverId: string;
  config: MutableDaemonConfig | null;
  connector: ConnectorConfig;
  isLoading: boolean;
  error: string | null;
  tools: { name: string; description: string | null }[];
}) {
  const { serverId, config, connector, isLoading, error, tools } = props;
  if (isLoading) {
    return <Text style={settingsStyles.rowHint}>Loading tools…</Text>;
  }
  if (error) {
    return <Text style={settingsStyles.rowError}>{error}</Text>;
  }
  if (tools.length === 0) {
    return <Text style={settingsStyles.rowHint}>This connector exposes no tools.</Text>;
  }
  return (
    <>
      {tools.map((tool) => (
        <ConnectorToolRow
          key={tool.name}
          serverId={serverId}
          config={config}
          connector={connector}
          toolName={tool.name}
          description={tool.description}
        />
      ))}
    </>
  );
}

// One connector card: header + global enable switch + remove, and an expandable
// tool list fetched live from the daemon on first expand.
function ConnectorCard(props: {
  serverId: string;
  config: MutableDaemonConfig | null;
  connector: ConnectorConfig;
}) {
  const { serverId, config, connector } = props;
  const client = useHostRuntimeClient(serverId);
  const enableMutation = usePatchMutation(serverId);
  const removeMutation = usePatchMutation(serverId);
  const [expanded, setExpanded] = useState(false);

  const toolsMutation = useMutation({
    mutationFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return client.connectorsListTools(connector.id);
    },
  });

  const toggleExpanded = useCallback(() => {
    // Fetch outside the setState updater - an updater must be pure (React may
    // double-invoke it in dev, firing two live MCP connects).
    if (!expanded && !toolsMutation.data && !toolsMutation.isPending) {
      toolsMutation.mutate();
    }
    setExpanded((prev) => !prev);
  }, [expanded, toolsMutation]);

  const onEnableChange = useCallback(
    (next: boolean) => {
      enableMutation.mutate(createSetConnectorEnabledPatch(config, connector.id, next));
    },
    [enableMutation, config, connector.id],
  );

  const handleRemove = useCallback(() => {
    removeMutation.mutate(createRemoveConnectorPatch(config, connector.id));
  }, [removeMutation, config, connector.id]);

  const toolsError = toErrorMessage(toolsMutation.error) ?? toolsMutation.data?.error ?? null;
  const tools = toolsMutation.data?.tools ?? NO_TOOLS;
  const enabled = isConnectorEnabled(connector);

  return (
    <View style={settingsStyles.card} testID={`connectors-card-${connector.id}`}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{connector.label ?? connector.id}</Text>
          <Text style={settingsStyles.rowHint}>
            {enabled ? "On" : "Off"} · {transportSummary(connector)}
          </Text>
          {enableMutation.isError ? (
            <Text style={settingsStyles.rowError}>{toErrorMessage(enableMutation.error)}</Text>
          ) : null}
        </View>
        <Switch
          value={enabled}
          onValueChange={onEnableChange}
          disabled={enableMutation.isPending}
          accessibilityLabel={`Enable ${connector.label ?? connector.id}`}
          testID={`connectors-card-${connector.id}-switch`}
        />
      </View>

      <View style={connectorStyles.borderedRow}>
        <Button
          onPress={toggleExpanded}
          variant="secondary"
          size="sm"
          testID={`connectors-card-${connector.id}-tools-toggle`}
        >
          {expanded ? "Hide tools" : "Show tools"}
        </Button>
        <Button
          onPress={handleRemove}
          variant="destructive"
          size="sm"
          disabled={removeMutation.isPending}
          testID={`connectors-card-${connector.id}-remove`}
        >
          Remove
        </Button>
      </View>

      {expanded ? (
        <View style={styles.toolsBody}>
          <ConnectorToolsBody
            serverId={serverId}
            config={config}
            connector={connector}
            isLoading={toolsMutation.isPending}
            error={toolsError}
            tools={tools}
          />
        </View>
      ) : null}
    </View>
  );
}

// The Connectors section: the connectors on this host, and the button that opens
// the catalog. Hidden entirely on daemons without the capability (nothing to
// manage there); shows an update-host note when connected but unsupported.
export function ConnectorsSection({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const hasFeature = useConnectorsFeature(serverId);
  const { config } = useDaemonConfig(serverId);
  const [addOpen, setAddOpen] = useState(false);

  const handleOpenAdd = useCallback(() => setAddOpen(true), []);
  const handleCloseAdd = useCallback(() => setAddOpen(false), []);

  const connectors = getConnectors(config);
  const enabledCount = connectors.filter(isConnectorEnabled).length;

  // The section header carries the tally, so "how many of mine are live" is
  // answered without reading down a column of switches.
  const trailing = useMemo(
    () => (
      <View style={styles.headerActions}>
        {connectors.length > 0 ? (
          <Text style={settingsStyles.rowHint} testID="connectors-enabled-count">
            {enabledCount} of {connectors.length} on
          </Text>
        ) : null}
        <Button
          onPress={handleOpenAdd}
          variant="secondary"
          size="sm"
          testID="connectors-add-button"
        >
          Add connector
        </Button>
      </View>
    ),
    [connectors.length, enabledCount, handleOpenAdd],
  );

  if (!isConnected) {
    return null;
  }

  if (!hasFeature) {
    return (
      <SettingsSection title="Connectors">
        <View style={settingsStyles.card} testID="connectors-update-host-card">
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowHint}>Update the host to manage connectors.</Text>
            </View>
          </View>
        </View>
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection title="Connectors" trailing={trailing} testID="connectors-section">
        {connectors.length === 0 ? (
          <View style={settingsStyles.card} testID="connectors-empty-card">
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No connectors yet. Pick one from the catalog and sign in; its tools become available
                to agents on the openai-compatible provider.
              </Text>
              <Button
                onPress={handleOpenAdd}
                variant="secondary"
                testID="connectors-empty-add-button"
              >
                Browse connectors
              </Button>
            </View>
          </View>
        ) : (
          connectors.map((connector) => (
            <ConnectorCard
              key={connector.id}
              serverId={serverId}
              config={config}
              connector={connector}
            />
          ))
        )}
      </SettingsSection>

      <AddConnectorSheet
        serverId={serverId}
        config={config}
        visible={addOpen}
        onClose={handleCloseAdd}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  emptyCard: {
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[6],
    paddingHorizontal: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  toolsBody: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
}));
