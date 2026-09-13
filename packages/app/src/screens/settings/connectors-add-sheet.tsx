import { CONNECTOR_CATALOG_TARGETS } from "@/screens/settings-search/nested-editor-targets";
import { SettingsButton } from "@/screens/settings-search/controls";
import { SettingsAdaptiveModalSheet as AdaptiveModalSheet } from "@/screens/settings-search/sheets";
import {
  SettingsTarget,
  SettingsTargetText,
  useSettingsSearchRequest,
} from "@/screens/settings-search/target";
// The add-a-connector surface: a dialog on desktop, a bottom sheet on mobile.
// It owns the whole catalog (search, audience filter, category groups, the
// per-entry install flow) plus the by-hand escape hatch, so the settings
// section behind it lists only the connectors you actually have.
//
// Nothing here asks the user what MCP is: the endpoint is already known, so the
// only possible question is the one credential the vendor cannot issue without
// them.
//
// i18n: English-only pending a translation pass (build-first, translate-last).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { StyleSheet } from "react-native-unistyles";
import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import type { ConnectorConfig } from "@otto-code/protocol/provider-config";
import {
  hostedConnectorVendor,
  HOSTED_CONNECTOR_DISCLOSURE,
} from "@otto-code/protocol/connector-hosted-auth";
import { useHostedConnectorFeature } from "./connectors-shared";
import { signInGoogleConnector } from "./connectors-google-sign-in";
import { CONNECTOR_CONSENT_MESSAGE, signInOauthConnector } from "./connectors-oauth-sign-in";
import {
  SHEET_HORIZONTAL_PADDING_SCALE,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { ConnectorIdentity } from "@/components/connector-identity";
import { isWeb } from "@/constants/platform";
import { daemonConfigQueryKey } from "@/data/daemon-config";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  buildCatalogConnectorServer,
  buildConnectorServer,
  connectorExists,
  createRemoveConnectorPatch,
  createAddConnectorPatch,
  addVerifiedCatalogConnector,
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
import {
  connectorStyles,
  toErrorMessage,
  useConnectorOauthFeature,
  useGoogleConnectorFeature,
  usePatchMutation,
} from "./connectors-shared";

const TRANSPORTS: ConnectorTransport[] = ["stdio", "http", "sse"];
type CatalogFilter = "all" | "user";
const CATALOG_FILTERS: { key: CatalogFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "user", label: "User mode" },
];

// Stable empty reference for the closed sheet, so re-rendering the settings
// page behind it does not hand the body a fresh array every time.
const CATALOG_SETTINGS_TARGETS = Object.values(CONNECTOR_CATALOG_TARGETS);

const NO_GROUPS: ReturnType<typeof groupCatalogByCategory> = [];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

// One transport chip in the by-hand form. A component (not an inline arrow) so
// its press handler is stable per option.
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

// A catalog audience filter chip (All / User mode). Stable handler per option.
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

// A single catalog entry row: what it is, and what it will ask of you.
function CatalogEntryRow(props: {
  entry: ConnectorCatalogEntry;
  installed: boolean;
  pendingAuthorization: boolean;
  onSelect: (entry: ConnectorCatalogEntry) => void;
}) {
  const { entry, installed, pendingAuthorization, onSelect } = props;
  const handlePress = useCallback(() => onSelect(entry), [onSelect, entry]);
  let label = installed ? "Added" : setupSummary(entry);
  if (pendingAuthorization) label = "Sign-in incomplete";
  return (
    <SettingsTarget
      settingId={CONNECTOR_CATALOG_TARGETS[entry.id] ?? []}
      style={settingsStyles.row}
      testID={`connectors-catalog-entry-${entry.id}`}
    >
      <ConnectorIdentity id={entry.id} label={entry.label}>
        <Text style={settingsStyles.rowHint}>{entry.description}</Text>
      </ConnectorIdentity>
      <SettingsButton
        settingIds={["host-tools-connectors-catalog-connector"]}
        onPress={handlePress}
        variant={installed ? "secondary" : "default"}
        size="sm"
        disabled={installed}
        testID={`connectors-catalog-entry-${entry.id}-add`}
      >
        {label}
      </SettingsButton>
    </SettingsTarget>
  );
}

// Where an install got to. Every step that can fail reports what actually
// failed, because "it didn't work" was the old catalog's whole problem.
type InstallPhase = "idle" | "adding" | "signing-in" | "verifying" | "done" | "error";

interface InstallState {
  phase: InstallPhase;
  message: string | null;
}

const IDLE_INSTALL: InstallState = { phase: "idle", message: null };

function CatalogInstallAction(props: {
  authorizationUrl: string | null;
  done: boolean;
  canInstall: boolean;
  isOauth: boolean;
  entryId: string;
  reopen(): void;
  onDone(): void;
  onInstall(): void;
}) {
  if (props.authorizationUrl)
    return (
      <Button onPress={props.reopen} variant="secondary" size="sm">
        Open sign-in page
      </Button>
    );
  if (props.done)
    return (
      <Button onPress={props.onDone} variant="secondary" size="sm">
        Done
      </Button>
    );
  return (
    <Button
      onPress={props.onInstall}
      variant="default"
      size="sm"
      disabled={!props.canInstall}
      testID={`connectors-install-${props.entryId}-submit`}
    >
      {props.isOauth ? "Connect" : "Add"}
    </Button>
  );
}

/**
 * The install panel for one catalog entry, expanded in place under its row so
 * the thing you clicked and the thing you act on stay together.
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
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const hasOauth = useConnectorOauthFeature(serverId);
  const hasGoogleOauth = useGoogleConnectorFeature(serverId);
  const hasHostedOauth = useHostedConnectorFeature(serverId);
  const hosted = hostedConnectorVendor({ server: buildCatalogConnectorServer(entry.setup) });
  const { patchConfig } = useDaemonConfig(serverId);
  const [token, setToken] = useState("");
  const authorizationAbort = useRef<AbortController | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  useEffect(() => () => authorizationAbort.current?.abort(), []);
  const [state, setState] = useState<InstallState>(IDLE_INSTALL);

  const needsToken = entry.setup.kind === "token";
  const isOauth = entry.setup.kind === "oauth";
  const builtin = entry.setup.kind === "oauth" ? entry.setup.builtin : undefined;
  let authSupported = hasOauth;
  let unavailableMessage = "Update the host to sign connectors in.";
  if (builtin) {
    authSupported = hasGoogleOauth;
    unavailableMessage = "Google sign-in is unavailable in this host build.";
  } else if (hosted) {
    authSupported = hasHostedOauth;
    unavailableMessage =
      "Hosted sign-in is not enabled on this host. Update the host or contact its administrator.";
  }
  const blockedOnHost = isOauth && !authSupported;
  const busy =
    state.phase === "adding" || state.phase === "signing-in" || state.phase === "verifying";
  const canInstall =
    !busy && !blockedOnHost && (!needsToken || token.trim().length > 0) && client !== null;

  const handleInstall = useCallback(() => {
    if (!client) {
      return;
    }
    const run = async (): Promise<void> => {
      const controller = new AbortController();
      authorizationAbort.current = controller;
      setAuthorizationUrl(null);
      setState({ phase: "adding", message: null });
      const server = buildCatalogConnectorServer(entry.setup, token);
      const connector: ConnectorConfig = {
        id: entry.id,
        label: entry.label,
        server,
        ...(builtin ? { builtin } : {}),
        enabled: true,
      };
      const result = await addVerifiedCatalogConnector({
        add: () => patchConfig(createAddConnectorPatch(config, connector)),
        remove: (saved) =>
          patchConfig(
            createRemoveConnectorPatch(
              queryClient.getQueryData<MutableDaemonConfig>(daemonConfigQueryKey(serverId)) ??
                saved,
              entry.id,
            ),
          ),
        verify: async () => {
          controller.signal.throwIfAborted();
          if (entry.setup.kind === "oauth") {
            setState({ phase: "signing-in", message: "Opening your browser to sign in…" });
            if (builtin) {
              await signInGoogleConnector(client, entry.id, controller.signal);
              await queryClient.invalidateQueries({
                queryKey: ["connector-authorization", serverId],
              });
            } else {
              await signInOauthConnector(client, entry.id, {
                signal: controller.signal,
                scope: entry.setup.scope,
                onWaiting: (url) => {
                  setAuthorizationUrl(url);
                  setState({ phase: "signing-in", message: CONNECTOR_CONSENT_MESSAGE });
                },
              });
              setAuthorizationUrl(null);
            }
          }

          setState({ phase: "verifying", message: "Checking the connection…" });
          const verified = await client.connectorsListTools(entry.id);
          if (verified.error) {
            throw new Error(verified.error);
          }
          if (verified.tools.length === 0) {
            throw new Error("This connector connected but exposed no tools.");
          }
          return verified;
        },
      });
      setState({
        phase: "done",
        message: `Connected. ${result.tools.length} ${result.tools.length === 1 ? "tool" : "tools"} available. Start or reload a chat to load them.`,
      });
    };
    void run().catch((error: unknown) => {
      setAuthorizationUrl(null);
      setState({ phase: "error", message: toErrorMessage(error) ?? "Could not connect." });
    });
  }, [client, config, entry, patchConfig, token, builtin, queryClient, serverId]);

  const reopen = useCallback(() => {
    if (authorizationUrl)
      void openExternalUrl(authorizationUrl).catch((error: unknown) => {
        setState({ phase: "signing-in", message: toErrorMessage(error) });
      });
  }, [authorizationUrl]);

  return (
    <View style={styles.installPanel} testID={`connectors-install-${entry.id}`}>
      {hosted ? <Text style={settingsStyles.rowHint}>{HOSTED_CONNECTOR_DISCLOSURE}</Text> : null}
      {builtin ? (
        <Text style={settingsStyles.rowHint}>
          Sign in with Google and approve access. Complete sign-in on the computer running this
          host.
        </Text>
      ) : null}
      {entry.setup.kind === "token" ? (
        <View style={styles.installRow}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{entry.setup.credential.label}</Text>
            <Text style={settingsStyles.rowHint}>Stored on the host, never sent to the app.</Text>
          </View>
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="Paste token"
            placeholderTextColor={connectorStyles.placeholderColor.color}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={connectorStyles.input}
            accessibilityLabel={entry.setup.credential.label}
            testID={`connectors-install-${entry.id}-token`}
          />
        </View>
      ) : null}

      <View style={styles.installRow}>
        <View style={settingsStyles.rowContent}>
          {blockedOnHost ? <Text style={settingsStyles.rowHint}>{unavailableMessage}</Text> : null}
          {state.message ? (
            <Text
              style={state.phase === "error" ? settingsStyles.rowError : settingsStyles.rowHint}
              testID={`connectors-install-${entry.id}-status`}
            >
              {state.message}
            </Text>
          ) : null}
        </View>
        <CatalogInstallAction
          authorizationUrl={authorizationUrl}
          done={state.phase === "done"}
          canInstall={canInstall}
          isOauth={isOauth}
          entryId={entry.id}
          reopen={reopen}
          onDone={onDone}
          onInstall={handleInstall}
        />
      </View>
    </View>
  );
}

/**
 * The by-hand escape hatch. This is where transports and commands legitimately
 * belong: the user is deliberately configuring a server we do not ship, and they
 * have its docs open. It is not the default path.
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
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <SettingsTargetText
            settingId="host-tools-connector-editor-name"
            style={settingsStyles.rowTitle}
          >
            Name
          </SettingsTargetText>
          {duplicate ? (
            <Text style={settingsStyles.rowError}>A connector named “{id}” already exists.</Text>
          ) : null}
        </View>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Acme"
          placeholderTextColor={connectorStyles.placeholderColor.color}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={connectorStyles.input}
          accessibilityLabel="Connector name"
          testID="connectors-add-name-input"
        />
      </View>

      <View style={connectorStyles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          <SettingsTargetText
            settingId="host-tools-connector-editor-transport"
            style={settingsStyles.rowTitle}
          >
            Transport
          </SettingsTargetText>
        </View>
        <View style={connectorStyles.chipRow}>
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

      <View style={connectorStyles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          <SettingsTargetText
            settingId={
              transport === "stdio"
                ? "host-tools-connector-editor-command"
                : "host-tools-connector-editor-url"
            }
            style={settingsStyles.rowTitle}
          >
            {transport === "stdio" ? "Command" : "URL"}
          </SettingsTargetText>
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
            placeholderTextColor={connectorStyles.placeholderColor.color}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={connectorStyles.input}
            accessibilityLabel="Connector command"
            testID="connectors-add-command-input"
          />
        ) : (
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://mcp.example.com"
            placeholderTextColor={connectorStyles.placeholderColor.color}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            inputMode="url"
            style={connectorStyles.input}
            accessibilityLabel="Connector URL"
            testID="connectors-add-url-input"
          />
        )}
      </View>

      <View style={connectorStyles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          <SettingsTargetText
            settingId="host-tools-connector-editor-token"
            style={settingsStyles.rowTitle}
          >
            Token
          </SettingsTargetText>
          <Text style={settingsStyles.rowHint}>
            Optional. Sent as API_KEY for stdio, or as a bearer token for http and sse.
          </Text>
        </View>
        <TextInput
          value={token}
          onChangeText={setToken}
          placeholder="Paste token"
          placeholderTextColor={connectorStyles.placeholderColor.color}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={connectorStyles.input}
          accessibilityLabel="Connector token"
          testID="connectors-add-token-input"
        />
      </View>

      <View style={connectorStyles.borderedRow}>
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

interface AddConnectorSheetProps {
  serverId: string;
  config: MutableDaemonConfig | null;
  visible: boolean;
  onClose: () => void;
}

/**
 * The catalog dialog. Search lives in the sheet header and the audience filter
 * in the pinned sub-header, so both stay put while the list scrolls; the list
 * itself is one card per category, rows divided by a hairline.
 */
export function AddConnectorSheet({ serverId, config, visible, onClose }: AddConnectorSheetProps) {
  const settingId = useSettingsSearchRequest();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (!visible || settingId === null || !CATALOG_SETTINGS_TARGETS.includes(settingId)) return;
    setQuery("");
    setFilter("all");
    setOpenCount((count) => count + 1);
  }, [visible, settingId]);

  // Reopening starts over: a stale search, an expanded row, or a half-filled
  // by-hand form are all answers to the last visit, not this one.
  useEffect(() => {
    const opening = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!opening) {
      return;
    }
    setQuery("");
    setFilter("all");
    setSelectedId(null);
    setManualOpen(false);
    setOpenCount((count) => count + 1);
  }, [visible]);

  // Selecting the open row closes it, so the same button is both open and undo.
  const handleSelectEntry = useCallback((entry: ConnectorCatalogEntry) => {
    setSelectedId((prev) => (prev === entry.id ? null : entry.id));
  }, []);
  const handleInstallDone = useCallback(() => setSelectedId(null), []);
  const toggleManual = useCallback(() => setManualOpen((prev) => !prev), []);

  const header = useMemo<SheetHeader>(
    () => ({
      title: "Add a connector",
      search: {
        onChange: setQuery,
        resetKey: `connectors:${openCount}`,
        placeholder: "Search connectors",
        autoFocus: isWeb && settingId === null,
        testID: "connectors-catalog-search",
      },
    }),
    [openCount, settingId],
  );

  const subHeader = useMemo(
    () => (
      <View style={styles.filterStrip}>
        {CATALOG_FILTERS.map((item) => (
          <CatalogFilterChip
            key={item.key}
            option={item.key}
            label={item.label}
            active={filter === item.key}
            onSelect={setFilter}
          />
        ))}
      </View>
    ),
    [filter],
  );

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={onClose}
          testID="connectors-add-sheet-done"
        >
          Done
        </Button>
      </View>
    ),
    [onClose],
  );

  // The sheet stays mounted while closed so it keeps its exit animation, so the
  // catalog search only runs while it is actually on screen.
  const groups = useMemo(() => {
    if (!visible) {
      return NO_GROUPS;
    }
    const entries = searchCatalog(
      catalogForAudience(filter === "user" ? "user" : undefined),
      query,
    );
    return groupCatalogByCategory(entries);
  }, [filter, query, visible]);

  const renderInstall = (entry: ConnectorCatalogEntry): ReactNode => (
    <CatalogInstallPanel
      serverId={serverId}
      config={config}
      entry={entry}
      onDone={handleInstallDone}
    />
  );

  return (
    <AdaptiveModalSheet
      header={header}
      subHeader={subHeader}
      footer={footer}
      visible={visible}
      onClose={onClose}
      testID="connectors-add-sheet"
    >
      {groups.length === 0 ? (
        <Text style={settingsStyles.rowHint} testID="connectors-catalog-empty">
          Nothing matches “{query.trim()}”. {KNOWN_ABSENT_NOTE}
        </Text>
      ) : null}

      {groups.map((group) => (
        <SettingsSection key={group.category} title={group.category}>
          <View style={settingsStyles.card}>
            {group.entries.map((entry, index) => (
              <View key={entry.id} style={index > 0 ? settingsStyles.rowBorder : undefined}>
                <CatalogEntryRow
                  entry={entry}
                  installed={connectorExists(config, entry.id)}
                  pendingAuthorization={
                    entry.setup.kind === "oauth" &&
                    !entry.setup.builtin &&
                    !!config?.connectors?.some(
                      (connector) =>
                        connector.id === entry.id &&
                        !connector.auth?.tokens &&
                        !connector.auth?.hosted?.connected,
                    )
                  }
                  onSelect={handleSelectEntry}
                />
                {selectedId === entry.id ? renderInstall(entry) : null}
              </View>
            ))}
          </View>
        </SettingsSection>
      ))}

      <SettingsSection title="Not listed" flush>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowHint}>{KNOWN_ABSENT_NOTE}</Text>
            </View>
            <SettingsButton
              settingIds={["host-tools-connectors-custom-connector"]}
              onPress={toggleManual}
              variant="secondary"
              size="sm"
              testID="connectors-manual-toggle"
            >
              {manualOpen ? "Close" : "Add custom"}
            </SettingsButton>
          </View>
          {manualOpen ? <ManualConnectorForm serverId={serverId} config={config} /> : null}
        </View>
      </SettingsSection>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Pinned under the header, so filtering never scrolls out of reach.
  filterStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    paddingTop: theme.spacing[4],
  },
  // Indented and rule-marked so an expanded row reads as belonging to the row
  // above it rather than as a new entry in the card.
  installPanel: {
    marginLeft: theme.spacing[4],
    marginBottom: theme.spacing[3],
    paddingLeft: theme.spacing[3],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
    gap: theme.spacing[3],
  },
  installRow: {
    flexDirection: { xs: "column", sm: "row" },
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingRight: theme.spacing[4],
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
}));
