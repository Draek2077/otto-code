// Connectors settings - daemon-wide MCP servers surfaced as named, toggle-able
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
import { useCallback, useState, type ReactNode } from "react";
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
import { openExternalUrl } from "@/utils/open-external-url";
import {
  buildCatalogConnectorServer,
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
  groupCatalogByCategory,
  KNOWN_ABSENT_NOTE,
  searchCatalog,
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

/**
 * Whether this host can run a connector's OAuth login.
 * COMPAT(connectorOauth): added in v0.7.7, drop the gate when daemon floor >= v0.7.7.
 */
export function useConnectorOauthFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.connectorOauth === true,
  );
}

/**
 * Resolve when the daemon reports this connector's login settled. Subscribed
 * BEFORE the browser is opened, so a login the user finishes instantly cannot
 * land in the gap between opening the URL and starting to listen.
 */
function waitForOauthStatus(
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>,
  connectorId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const unsubscribe = client.on("connectors.oauth.status", (message) => {
      if (message.payload.connectorId !== connectorId) {
        return;
      }
      unsubscribe();
      if (message.payload.status === "connected") {
        resolve();
        return;
      }
      reject(new Error(message.payload.error ?? "Sign-in failed."));
    });
  });
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

// What the user has to do to turn this entry on, said in one short phrase. The
// point of the catalog rebuild: the answer is "sign in" for most of them, and
// never "go read the vendor's MCP docs and type a command".
function setupSummary(entry: ConnectorCatalogEntry): string {
  if (entry.setup.kind === "oauth") {
    return "Sign in";
  }
  if (entry.setup.kind === "none") {
    return "No account needed";
  }
  return entry.setup.credential.label;
}

// A single catalog entry row in the browse panel: what it is, and what it will
// ask of you. A component (not an inline arrow) so its handler is stable.
function CatalogEntryButton(props: {
  entry: ConnectorCatalogEntry;
  installed: boolean;
  onSelect: (entry: ConnectorCatalogEntry) => void;
}) {
  const { entry, installed, onSelect } = props;
  const handlePress = useCallback(() => onSelect(entry), [onSelect, entry]);
  return (
    <View style={styles.catalogEntryRow} testID={`connectors-catalog-entry-${entry.id}`}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{entry.label}</Text>
        <Text style={settingsStyles.rowHint}>{entry.description}</Text>
      </View>
      <Button
        onPress={handlePress}
        variant={installed ? "secondary" : "default"}
        size="sm"
        disabled={installed}
        testID={`connectors-catalog-entry-${entry.id}-add`}
      >
        {installed ? "Added" : setupSummary(entry)}
      </Button>
    </View>
  );
}

// The browse panel: search, an audience filter, then category-grouped rows. The
// selected row expands in place rather than opening a panel further down the
// page, so the thing you clicked and the thing you act on stay together.
function CatalogBrowser(props: {
  filter: CatalogFilter;
  query: string;
  config: MutableDaemonConfig | null;
  selectedId: string | null;
  onFilterChange: (filter: CatalogFilter) => void;
  onQueryChange: (query: string) => void;
  onSelect: (entry: ConnectorCatalogEntry) => void;
  renderInstall: (entry: ConnectorCatalogEntry) => ReactNode;
}) {
  const {
    filter,
    query,
    config,
    selectedId,
    onFilterChange,
    onQueryChange,
    onSelect,
    renderInstall,
  } = props;
  const visible = searchCatalog(catalogForAudience(filter === "user" ? "user" : undefined), query);
  const groups = groupCatalogByCategory(visible);
  return (
    <View style={styles.browsePanel} testID="connectors-catalog-browser">
      <TextInput
        value={query}
        onChangeText={onQueryChange}
        placeholder="Search connectors"
        placeholderTextColor={styles.placeholderColor.color}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={styles.searchInput}
        accessibilityLabel="Search connectors"
        testID="connectors-catalog-search"
      />
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
      {groups.length === 0 ? (
        <Text style={settingsStyles.rowHint} testID="connectors-catalog-empty">
          Nothing matches “{query.trim()}”. {KNOWN_ABSENT_NOTE}
        </Text>
      ) : null}
      {groups.map((group) => (
        <View key={group.category} style={styles.catalogGroup}>
          <Text style={settingsStyles.rowHint}>{group.category}</Text>
          <View style={styles.catalogGroupItems}>
            {group.entries.map((entry) => (
              <View key={entry.id}>
                <CatalogEntryButton
                  entry={entry}
                  installed={connectorExists(config, entry.id)}
                  onSelect={onSelect}
                />
                {selectedId === entry.id ? renderInstall(entry) : null}
              </View>
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

// Where an install got to. Every step that can fail reports what actually
// failed, because "it didn't work" was the old catalog's whole problem.
type InstallPhase = "idle" | "adding" | "signing-in" | "verifying" | "done" | "error";

interface InstallState {
  phase: InstallPhase;
  message: string | null;
}

const IDLE_INSTALL: InstallState = { phase: "idle", message: null };

/**
 * The install panel for one catalog entry. Nothing here asks the user what MCP
 * is: the endpoint is already known, so the only possible question is the one
 * credential the vendor cannot issue without them.
 *
 * The sequence is add, then authorize (if it signs in), then verify by actually
 * connecting and counting tools. Verification is not cosmetic - it is the step
 * that would have caught a catalog full of commands that cannot run.
 */
function CatalogInstallPanel(props: {
  serverId: string;
  config: MutableDaemonConfig | null;
  entry: ConnectorCatalogEntry;
  onDone: () => void;
}) {
  const { serverId, config, entry, onDone } = props;
  const client = useHostRuntimeClient(serverId);
  const hasOauth = useConnectorOauthFeature(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  const [token, setToken] = useState("");
  const [state, setState] = useState<InstallState>(IDLE_INSTALL);

  const needsToken = entry.setup.kind === "token";
  const isOauth = entry.setup.kind === "oauth";
  const blockedOnHost = isOauth && !hasOauth;
  const busy =
    state.phase === "adding" || state.phase === "signing-in" || state.phase === "verifying";
  const canInstall =
    !busy && !blockedOnHost && (!needsToken || token.trim().length > 0) && client !== null;

  const handleInstall = useCallback(() => {
    if (!client) {
      return;
    }
    const run = async (): Promise<void> => {
      setState({ phase: "adding", message: null });
      const server = buildCatalogConnectorServer(entry.setup, token);
      const connector: ConnectorConfig = {
        id: entry.id,
        label: entry.label,
        server,
        enabled: true,
      };
      const patched = await patchConfig(createAddConnectorPatch(config, connector));
      if (!patched) {
        throw new Error("Host disconnected");
      }

      if (entry.setup.kind === "oauth") {
        setState({ phase: "signing-in", message: "Opening your browser to sign in…" });
        const scope = entry.setup.scope;
        const authorization = await client.connectorsOauthAuthorize(entry.id, scope);
        if (authorization.status === "error") {
          throw new Error(authorization.error ?? "Sign-in failed.");
        }
        if (authorization.status === "redirect" && authorization.authorizationUrl) {
          // The daemon holds the loopback listener open while the user is away;
          // the push below is what tells us they came back.
          const settled = waitForOauthStatus(client, entry.id);
          void openExternalUrl(authorization.authorizationUrl);
          await settled;
        }
      }

      setState({ phase: "verifying", message: "Checking the connection…" });
      const result = await client.connectorsListTools(entry.id);
      if (result.error) {
        throw new Error(result.error);
      }
      setState({
        phase: "done",
        message: `Connected. ${result.tools.length} ${result.tools.length === 1 ? "tool" : "tools"} available.`,
      });
    };
    void run().catch((error: unknown) => {
      setState({ phase: "error", message: toErrorMessage(error) ?? "Could not connect." });
    });
  }, [client, config, entry, patchConfig, token]);

  return (
    <View style={styles.installPanel} testID={`connectors-install-${entry.id}`}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{entry.label}</Text>
        <Text style={settingsStyles.rowHint}>{entry.description}</Text>
      </View>

      {entry.setup.kind === "token" ? (
        <View style={styles.borderedRow}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{entry.setup.credential.label}</Text>
            <Text style={settingsStyles.rowHint}>Stored on the host, never sent to the app.</Text>
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
            accessibilityLabel={entry.setup.credential.label}
            testID={`connectors-install-${entry.id}-token`}
          />
        </View>
      ) : null}

      <View style={styles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          {blockedOnHost ? (
            <Text style={settingsStyles.rowHint}>Update the host to sign connectors in.</Text>
          ) : null}
          {state.message ? (
            <Text
              style={state.phase === "error" ? settingsStyles.rowError : settingsStyles.rowHint}
              testID={`connectors-install-${entry.id}-status`}
            >
              {state.message}
            </Text>
          ) : null}
        </View>
        {state.phase === "done" ? (
          <Button onPress={onDone} variant="secondary" size="sm">
            Done
          </Button>
        ) : (
          <Button
            onPress={handleInstall}
            variant="default"
            size="sm"
            disabled={!canInstall}
            testID={`connectors-install-${entry.id}-submit`}
          >
            {isOauth ? "Connect" : "Add"}
          </Button>
        )}
      </View>
    </View>
  );
}

// The add-connector surface: the catalog first, with the by-hand form tucked
// behind a disclosure for servers the catalog does not carry.
function AddConnectorCard(props: { serverId: string; config: MutableDaemonConfig | null }) {
  const { serverId, config } = props;
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  // Open by default. The catalog IS the feature; making the user press Browse
  // before they can see anything is a click that buys nothing.
  const [browseOpen, setBrowseOpen] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [query, setQuery] = useState("");

  const toggleBrowse = useCallback(() => setBrowseOpen((prev) => !prev), []);
  const toggleManual = useCallback(() => setManualOpen((prev) => !prev), []);
  // Selecting the open row closes it, so the same button is both open and undo.
  const handleSelectEntry = useCallback((entry: ConnectorCatalogEntry) => {
    setSelectedCatalogId((prev) => (prev === entry.id ? null : entry.id));
  }, []);
  const handleInstallDone = useCallback(() => setSelectedCatalogId(null), []);
  const renderInstall = useCallback(
    (entry: ConnectorCatalogEntry) => (
      <CatalogInstallPanel
        serverId={serverId}
        config={config}
        entry={entry}
        onDone={handleInstallDone}
      />
    ),
    [serverId, config, handleInstallDone],
  );

  return (
    <View style={settingsStyles.card} testID="connectors-add-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Add a connector</Text>
          <Text style={settingsStyles.rowHint}>
            Pick one and sign in. Its tools become available to agents on the openai-compatible
            provider.
          </Text>
        </View>
        <Button
          onPress={toggleBrowse}
          variant="secondary"
          size="sm"
          testID="connectors-browse-toggle"
        >
          {browseOpen ? "Hide catalog" : "Browse connectors"}
        </Button>
      </View>

      {browseOpen ? (
        <CatalogBrowser
          filter={filter}
          query={query}
          config={config}
          selectedId={selectedCatalogId}
          onFilterChange={setFilter}
          onQueryChange={setQuery}
          onSelect={handleSelectEntry}
          renderInstall={renderInstall}
        />
      ) : null}

      <View style={styles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowHint}>{KNOWN_ABSENT_NOTE}</Text>
        </View>
        <Button onPress={toggleManual} variant="ghost" size="sm" testID="connectors-manual-toggle">
          {manualOpen ? "Close" : "Add custom connector"}
        </Button>
      </View>

      {manualOpen ? <ManualConnectorForm serverId={serverId} config={config} /> : null}
    </View>
  );
}

/**
 * The by-hand escape hatch. This is where transports and commands legitimately
 * belong: the user is deliberately configuring a server we do not ship, and they
 * have its docs open. It is no longer the default path.
 */
function ManualConnectorForm(props: { serverId: string; config: MutableDaemonConfig | null }) {
  const { serverId, config } = props;
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<ConnectorTransport>("stdio");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const mutation = usePatchMutation(serverId);

  const id = slugify(name);
  const credential: ConnectorCredentialInput | null =
    token.trim().length > 0 ? { token, envVar: "API_KEY" } : null;
  const server = buildConnectorServer({ transport, command, url, credential });
  const duplicate = id.length > 0 && connectorExists(config, id);
  const canAdd = id.length > 0 && server !== null && !duplicate && !mutation.isPending;

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
      },
    });
  }, [server, id, name, config, mutation]);

  return (
    <View testID="connectors-manual-form">
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
          placeholder="e.g. Acme"
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

      <View style={styles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Token</Text>
          <Text style={settingsStyles.rowHint}>
            Optional. Sent as API_KEY for stdio, or as a bearer token for http and sse.
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
          accessibilityLabel="Connector token"
          testID="connectors-add-token-input"
        />
      </View>

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
  // A column now, not a wrapped chip row: entries carry a description and an
  // action, so they read as rows rather than tags.
  catalogGroupItems: {
    gap: theme.spacing[1],
  },
  catalogEntryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  // Indented and tinted so an expanded row reads as belonging to the row above
  // it rather than as a new section.
  installPanel: {
    marginLeft: theme.spacing[3],
    marginBottom: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  searchInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
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
