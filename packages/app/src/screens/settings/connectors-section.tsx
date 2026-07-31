// Connectors settings — daemon-wide MCP servers surfaced as named, toggle-able
// integrations. Each connector has a global enable switch and an expandable list
// of its tools with per-tool disable. Adding a connector writes an MCP transport
// descriptor to daemon config; the daemon connects and (on the openai-compat
// path) folds the enabled tools into the model's tool set.
//
// Mirrors the toggle mechanics of otto-tools-section and the per-entry card
// layout of git-providers-settings-cards. Enforcement lives in the daemon; this
// is the control surface.
//
// i18n: English-only pending a translation pass (build-first, translate-last).
import { useCallback, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { StyleSheet } from "react-native-unistyles";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@otto-code/protocol/messages";
import type { ConnectorConfig } from "@otto-code/protocol/provider-config";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import {
  buildConnectorServer,
  connectorExists,
  createAddConnectorPatch,
  createRemoveConnectorPatch,
  createSetConnectorEnabledPatch,
  createSetConnectorToolDisabledPatch,
  getConnectors,
  isConnectorEnabled,
  isConnectorToolDisabled,
  type ConnectorCredentialInput,
  type ConnectorTransport,
} from "./connectors-config";
import {
  catalogForAudience,
  CONNECTOR_CATALOG,
  groupCatalogByCategory,
  type ConnectorCatalogEntry,
} from "./connectors-catalog";

const TRANSPORTS: ConnectorTransport[] = ["stdio", "http", "sse"];
type CatalogFilter = "all" | "user";
const CATALOG_FILTERS: { key: CatalogFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "user", label: "User mode" },
];
// Stable empty reference so a connector with no fetched tools yet doesn't hand a
// fresh array literal down as a prop on every render.
const NO_TOOLS: { name: string; description: string | null }[] = [];

/**
 * The single detection point for the connectors capability.
 * COMPAT(connectors): added in v0.7.5, drop the gate when daemon floor >= v0.7.5.
 */
export function useConnectorsFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.connectors === true,
  );
}

function toErrorMessage(error: unknown): string | null {
  if (!error) {
    return null;
  }
  return error instanceof Error ? error.message : String(error);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function transportSummary(connector: ConnectorConfig): string {
  const server = connector.server;
  return server.type === "stdio" ? `stdio · ${server.command}` : `${server.type} · ${server.url}`;
}

// One transport chip in the add form. A component (not an inline arrow) so its
// press handler is stable per option.
function TransportButton(props: {
  option: ConnectorTransport;
  active: boolean;
  onSelect: (option: ConnectorTransport) => void;
}) {
  const { option, active, onSelect } = props;
  const handlePress = useCallback(() => onSelect(option), [onSelect, option]);
  return (
    <Button
      onPress={handlePress}
      variant={active ? "default" : "secondary"}
      size="sm"
      testID={`connectors-add-transport-${option}`}
    >
      {option}
    </Button>
  );
}

// A catalog filter chip (All / User mode). Stable handler per option.
function CatalogFilterChip(props: {
  option: CatalogFilter;
  label: string;
  active: boolean;
  onSelect: (option: CatalogFilter) => void;
}) {
  const { option, label, active, onSelect } = props;
  const handlePress = useCallback(() => onSelect(option), [onSelect, option]);
  return (
    <Button
      onPress={handlePress}
      variant={active ? "default" : "secondary"}
      size="sm"
      testID={`connectors-catalog-filter-${option}`}
    >
      {label}
    </Button>
  );
}

// A single catalog entry row in the browse panel. Selecting it pre-fills the
// add form. A component (not an inline arrow) so its handler is stable.
function CatalogEntryButton(props: {
  entry: ConnectorCatalogEntry;
  onSelect: (entry: ConnectorCatalogEntry) => void;
}) {
  const { entry, onSelect } = props;
  const handlePress = useCallback(() => onSelect(entry), [onSelect, entry]);
  return (
    <Button
      onPress={handlePress}
      variant="ghost"
      size="sm"
      testID={`connectors-catalog-entry-${entry.id}`}
    >
      {entry.label}
    </Button>
  );
}

// The browse panel: a filter row (All / User mode) over a category-grouped list
// of catalog entries. Selecting one calls onSelect with the entry.
function CatalogBrowser(props: {
  filter: CatalogFilter;
  onFilterChange: (filter: CatalogFilter) => void;
  onSelect: (entry: ConnectorCatalogEntry) => void;
}) {
  const { filter, onFilterChange, onSelect } = props;
  const groups = groupCatalogByCategory(catalogForAudience(filter === "user" ? "user" : undefined));
  return (
    <View style={styles.browsePanel} testID="connectors-catalog-browser">
      <View style={styles.transportRow}>
        {CATALOG_FILTERS.map((item) => (
          <CatalogFilterChip
            key={item.key}
            option={item.key}
            label={item.label}
            active={filter === item.key}
            onSelect={onFilterChange}
          />
        ))}
      </View>
      {groups.map((group) => (
        <View key={group.category} style={styles.catalogGroup}>
          <Text style={settingsStyles.rowHint}>{group.category}</Text>
          <View style={styles.catalogGroupItems}>
            {group.entries.map((entry) => (
              <CatalogEntryButton key={entry.id} entry={entry} onSelect={onSelect} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function usePatchMutation(serverId: string) {
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

// The add-connector form: browse the catalog to pre-fill, or enter an MCP server
// by hand. Writes a new connector (enabled) to the registry, then clears.
function AddConnectorCard(props: { serverId: string; config: MutableDaemonConfig | null }) {
  const { serverId, config } = props;
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<ConnectorTransport>("stdio");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const mutation = usePatchMutation(serverId);

  const selectedEntry = selectedCatalogId
    ? (CONNECTOR_CATALOG.find((entry) => entry.id === selectedCatalogId) ?? null)
    : null;
  const credentialSlot = selectedEntry?.credential ?? null;

  const id = slugify(name);
  const credential: ConnectorCredentialInput | null = credentialSlot
    ? { token, envVar: credentialSlot.envVar }
    : null;
  const server = buildConnectorServer({ transport, command, url, credential });
  const duplicate = id.length > 0 && connectorExists(config, id);
  const canAdd = id.length > 0 && server !== null && !duplicate && !mutation.isPending;

  const toggleBrowse = useCallback(() => setBrowseOpen((prev) => !prev), []);

  const handleSelectEntry = useCallback((entry: ConnectorCatalogEntry) => {
    setName(entry.label);
    setTransport(entry.transport);
    if (entry.transport === "stdio") {
      setCommand(entry.template);
      setUrl("");
    } else {
      setUrl(entry.template);
      setCommand("");
    }
    setToken("");
    setSelectedCatalogId(entry.id);
    setBrowseOpen(false);
  }, []);

  const handleAdd = useCallback(() => {
    if (!server || id.length === 0) {
      return;
    }
    const connector: ConnectorConfig = { id, label: name.trim(), server, enabled: true };
    mutation.mutate(createAddConnectorPatch(config, connector), {
      onSuccess: () => {
        setName("");
        setCommand("");
        setUrl("");
        setToken("");
        setSelectedCatalogId(null);
      },
    });
  }, [server, id, name, config, mutation]);

  return (
    <View style={settingsStyles.card} testID="connectors-add-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Add a connector</Text>
          <Text style={settingsStyles.rowHint}>
            Browse the catalog to pre-fill, or enter an MCP server by hand. Its tools become
            available to agents on the openai-compatible provider.
          </Text>
        </View>
        <Button
          onPress={toggleBrowse}
          variant="secondary"
          size="sm"
          testID="connectors-browse-toggle"
        >
          {browseOpen ? "Close catalog" : "Browse connectors"}
        </Button>
      </View>

      {browseOpen ? (
        <CatalogBrowser filter={filter} onFilterChange={setFilter} onSelect={handleSelectEntry} />
      ) : null}

      <View style={styles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Name</Text>
          {duplicate ? (
            <Text style={settingsStyles.rowError}>A connector named “{id}” already exists.</Text>
          ) : null}
        </View>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Slack"
          placeholderTextColor={styles.placeholderColor.color}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={styles.input}
          accessibilityLabel="Connector name"
          testID="connectors-add-name-input"
        />
      </View>

      <View style={styles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Transport</Text>
        </View>
        <View style={styles.transportRow}>
          {TRANSPORTS.map((option) => (
            <TransportButton
              key={option}
              option={option}
              active={transport === option}
              onSelect={setTransport}
            />
          ))}
        </View>
      </View>

      <View style={styles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{transport === "stdio" ? "Command" : "URL"}</Text>
          <Text style={settingsStyles.rowHint}>
            {transport === "stdio"
              ? "The executable and its arguments, e.g. npx -y @acme/mcp-server."
              : "The server endpoint URL."}
          </Text>
        </View>
        {transport === "stdio" ? (
          <TextInput
            value={command}
            onChangeText={setCommand}
            placeholder="npx -y @acme/mcp-server"
            placeholderTextColor={styles.placeholderColor.color}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={styles.input}
            accessibilityLabel="Connector command"
            testID="connectors-add-command-input"
          />
        ) : (
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://mcp.example.com"
            placeholderTextColor={styles.placeholderColor.color}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            inputMode="url"
            style={styles.input}
            accessibilityLabel="Connector URL"
            testID="connectors-add-url-input"
          />
        )}
      </View>

      {credentialSlot ? (
        <View style={styles.borderedRow}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{credentialSlot.label}</Text>
            <Text style={settingsStyles.rowHint}>
              Stored on the host.{" "}
              {selectedEntry?.homepage ? `See ${selectedEntry.homepage} for setup.` : ""}
            </Text>
          </View>
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="Paste token"
            placeholderTextColor={styles.placeholderColor.color}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={styles.input}
            accessibilityLabel={credentialSlot.label}
            testID="connectors-add-token-input"
          />
        </View>
      ) : null}

      <View style={styles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          {mutation.isError ? (
            <Text style={settingsStyles.rowError}>{toErrorMessage(mutation.error)}</Text>
          ) : null}
        </View>
        <Button
          onPress={handleAdd}
          variant="default"
          size="sm"
          disabled={!canAdd}
          testID="connectors-add-submit"
        >
          Add connector
        </Button>
      </View>
    </View>
  );
}

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
    // Fetch outside the setState updater — an updater must be pure (React may
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

  return (
    <View style={settingsStyles.card} testID={`connectors-card-${connector.id}`}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{connector.label ?? connector.id}</Text>
          <Text style={settingsStyles.rowHint}>{transportSummary(connector)}</Text>
          {enableMutation.isError ? (
            <Text style={settingsStyles.rowError}>{toErrorMessage(enableMutation.error)}</Text>
          ) : null}
        </View>
        <Switch
          value={isConnectorEnabled(connector)}
          onValueChange={onEnableChange}
          disabled={enableMutation.isPending}
          accessibilityLabel={`Enable ${connector.label ?? connector.id}`}
          testID={`connectors-card-${connector.id}-switch`}
        />
      </View>

      <View style={styles.borderedRow}>
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

// The Connectors section: an add form followed by one card per registered
// connector. Hidden entirely on daemons without the capability (nothing to
// manage there); shows an update-host note when connected but unsupported.
export function ConnectorsSection({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const hasFeature = useConnectorsFeature(serverId);
  const { config } = useDaemonConfig(serverId);

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

  const connectors = getConnectors(config);

  return (
    <SettingsSection title="Connectors">
      <AddConnectorCard serverId={serverId} config={config} />
      {connectors.map((connector) => (
        <ConnectorCard
          key={connector.id}
          serverId={serverId}
          config={config}
          connector={connector}
        />
      ))}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
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
  transportRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  browsePanel: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
  },
  catalogGroup: {
    gap: theme.spacing[2],
  },
  catalogGroupItems: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
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
