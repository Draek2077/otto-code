import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { StyleSheet } from "react-native-unistyles";
import type {
  ForgeConnection,
  ForgeConnectionsAction,
  ForgeConnectionsOverview,
} from "@otto-code/protocol/forge-connections";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { invalidateCheckoutGitQueriesForServer } from "@/git/query-keys";

const PROVIDERS = [
  { id: "github", label: "GitHub", host: "github.com" },
  { id: "bitbucket-cloud", label: "Bitbucket Cloud", host: "bitbucket.org" },
  { id: "gitlab", label: "GitLab", host: "gitlab.com" },
  { id: "gitea", label: "Gitea", host: "" },
  { id: "forgejo", label: "Forgejo", host: "" },
  { id: "codeberg", label: "Codeberg", host: "codeberg.org" },
];

const TOKEN_GUIDES: Record<string, string> = {
  github:
    "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
  gitlab: "https://docs.gitlab.com/user/profile/personal_access_tokens/",
  "bitbucket-cloud": "https://id.atlassian.com/manage-profile/security/api-tokens",
};

export function ForgeConnectionsSettings(props: { serverId: string; projectId?: string }) {
  // COMPAT(forgeConnections): added in v0.9.6, remove gate after 2027-03-09 when floor >= v0.9.6.
  const supported = useSessionStore(
    (s) => s.sessions[props.serverId]?.serverInfo?.features?.forgeConnections === true,
  );
  return (
    <View style={settingsStyles.section}>
      <Text style={settingsStyles.sectionTitle}>Git connections</Text>
      {supported ? (
        <ConnectionsContent key={`${props.serverId}:${props.projectId ?? "host"}`} {...props} />
      ) : (
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>
              Update the host to configure Git connections.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function ConnectionsContent({ serverId, projectId }: { serverId: string; projectId?: string }) {
  const client = useHostRuntimeClient(serverId);
  const queries = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ForgeConnection | "new" | null>(null);
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["forge-connections", serverId, projectId ?? null],
    enabled: !!client,
    queryFn: async () => {
      const result = await client!.manageForgeConnections({ kind: "list", projectId });
      if (result.error || !result.overview)
        throw new Error(result.error ?? "Could not load Git connections.");
      return result.overview;
    },
  });
  // Credential-bearing arguments must not enter React Query's mutation cache.
  const apply = useCallback(
    async (action: ForgeConnectionsAction): Promise<ForgeConnectionsOverview> => {
      if (!client) throw new Error("Host disconnected.");
      const result = await client.manageForgeConnections(action);
      if (result.error || !result.overview)
        throw new Error(result.error ?? "Could not update Git connections.");
      return result.overview;
    },
    [client],
  );
  const perform = useCallback(
    async (operation: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await operation();
        await invalidateCheckoutGitQueriesForServer(queries, serverId);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Could not update Git connections.");
      } finally {
        setBusy(false);
        await queries.invalidateQueries({ queryKey: ["forge-connections", serverId] });
      }
    },
    [queries, serverId],
  );
  const overview = query.data;
  const handleSelect = useCallback(
    (action: ForgeConnectionsAction) => {
      void perform(async () => {
        await apply(action);
      });
    },
    [apply, perform],
  );
  const cancelEdit = useCallback(() => setEditing(null), []);
  const addConnection = useCallback(() => setEditing("new"), []);
  const handleSave = useCallback(
    (action: Extract<ForgeConnectionsAction, { kind: "save" }>) =>
      perform(async () => {
        await apply({ ...action, projectId, useForScope: !action.id });
        setEditing(null);
      }),
    [apply, perform, projectId],
  );
  return (
    <View style={settingsStyles.card} testID="forge-connections-settings">
      <View style={styles.block}>
        <Text style={settingsStyles.rowHint}>
          {projectId
            ? "Use the host default, or choose another account for this project and all its worktrees."
            : "Save accounts on this host and choose a default for each Git server. Projects can choose another account."}
        </Text>
        <Text style={settingsStyles.rowHint}>
          Git commits, SSH keys and push credentials keep using your Git configuration.
        </Text>
        {!overview && (
          <Text style={settingsStyles.rowHint}>
            {client ? "Loading connections…" : "Host disconnected."}
          </Text>
        )}
        {(error || query.error) && (
          <Text accessibilityRole="alert" style={settingsStyles.rowError}>
            {error ?? query.error?.message}
          </Text>
        )}
      </View>
      {overview && (
        <ConnectionBindings
          overview={overview}
          disabled={busy || !client}
          onSelect={handleSelect}
        />
      )}
      {!projectId &&
        overview?.connections.map((connection) => (
          <SavedConnection
            key={connection.id}
            connection={connection}
            busy={busy}
            onEdit={setEditing}
            onRemove={handleSelect}
          />
        ))}
      <View style={styles.block}>
        {editing ? (
          <ConnectionForm
            key={editing === "new" ? "new" : editing.id}
            connection={editing === "new" ? undefined : editing}
            busy={busy || !client}
            onCancel={cancelEdit}
            onSave={handleSave}
            project={!!projectId}
          />
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !overview}
            onPress={addConnection}
          >
            Add connection
          </Button>
        )}
      </View>
    </View>
  );
}

function ConnectionBindings({
  overview,
  disabled,
  onSelect,
}: {
  overview: ForgeConnectionsOverview;
  disabled: boolean;
  onSelect: (action: ForgeConnectionsAction) => void;
}) {
  const endpoints = new Map<string, { forge: string; host: string }>();
  for (const entry of [...overview.connections, ...overview.defaults, ...overview.overrides])
    endpoints.set(`${entry.forge}:${entry.host}`, entry);
  return (
    <>
      {[...endpoints.values()].map(({ forge, host }) => (
        <ConnectionBinding
          key={`${forge}:${host}`}
          forge={forge}
          host={host}
          overview={overview}
          disabled={disabled}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function ConnectionBinding({
  forge,
  host,
  overview,
  disabled,
  onSelect,
}: {
  forge: string;
  host: string;
  overview: ForgeConnectionsOverview;
  disabled: boolean;
  onSelect: (action: ForgeConnectionsAction) => void;
}) {
  const projectId = overview.projectId ?? undefined;
  const select = useCallback(
    (id: string) =>
      onSelect({
        kind: "select",
        projectId,
        forge,
        host,
        connectionId: id === "inherit" ? null : id,
      }),
    [onSelect, projectId, forge, host],
  );
  const matches = (c: { forge: string; host: string }) => c.forge === forge && c.host === host;
  const connections = overview.connections.filter(matches);
  const hostDefault = overview.defaults.find(matches);
  const selected = (projectId ? overview.overrides : overview.defaults).find(matches);
  const inherited = overview.connections.find((c) => c.id === hostDefault?.connectionId);
  let fallback = "Use existing host configuration";
  if (projectId)
    fallback = `Use host default (${inherited?.label ?? (hostDefault ? "unavailable" : "existing configuration")})`;
  const choices = [
    { id: "inherit", label: fallback },
    ...connections.map((c) => ({ id: c.id, label: `${c.label} · ${c.account}` })),
  ];
  const missing = selected && !connections.some((c) => c.id === selected.connectionId);
  if (missing)
    choices.push({ id: selected.connectionId, label: "Selected connection unavailable" });
  return (
    <View key={`${forge}:${host}`} style={styles.block}>
      <Text style={settingsStyles.rowTitle}>
        {PROVIDERS.find((p) => p.id === forge)?.label ?? forge} · {host}
      </Text>
      <ConnectionChoice
        label="Connection"
        value={selected?.connectionId ?? "inherit"}
        options={choices}
        disabled={disabled}
        onSelect={select}
      />
      {missing && (
        <Text style={settingsStyles.rowError}>
          Choose a connection to resume Git server features. Another account will not be used
          automatically.
        </Text>
      )}
    </View>
  );
}

function SavedConnection({
  connection,
  busy,
  onEdit,
  onRemove,
}: {
  connection: ForgeConnection;
  busy: boolean;
  onEdit: (connection: ForgeConnection) => void;
  onRemove: (action: ForgeConnectionsAction) => void;
}) {
  const edit = useCallback(() => onEdit(connection), [connection, onEdit]);
  const remove = useCallback(async () => {
    if (
      await confirmDialog({
        title: "Remove connection?",
        message: `Remove ${connection.label} from this host? Projects using it will need another connection.`,
        confirmLabel: "Remove",
        destructive: true,
      })
    )
      onRemove({ kind: "remove", id: connection.id, expectedRevision: connection.revision });
  }, [connection, onRemove]);
  return (
    <View style={[styles.block, styles.actions]}>
      <View style={styles.identity}>
        <Text style={settingsStyles.rowTitle}>{connection.label}</Text>
        <Text style={settingsStyles.rowHint}>
          {connection.account} · {connection.host}
        </Text>
      </View>
      <Button size="sm" variant="secondary" disabled={busy} onPress={edit}>
        Reconnect
      </Button>
      <Button size="sm" variant="destructive" disabled={busy} onPress={remove}>
        Remove
      </Button>
    </View>
  );
}

function ConnectionChoice({
  label,
  value,
  options,
  onSelect,
  disabled,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  const anchor = useRef<View>(null);
  return (
    <View ref={anchor}>
      <Combobox
        anchorRef={anchor}
        value={value}
        options={options}
        onSelect={onSelect}
        searchable={false}
      >
        <Button variant="secondary" size="sm" disabled={disabled} accessibilityLabel={label}>
          {options.find((o) => o.id === value)?.label ?? label}
        </Button>
      </Combobox>
    </View>
  );
}

function ConnectionForm({
  connection,
  busy,
  onCancel,
  onSave,
  project,
}: {
  connection?: ForgeConnection;
  busy: boolean;
  onCancel: () => void;
  onSave: (action: Extract<ForgeConnectionsAction, { kind: "save" }>) => Promise<void>;
  project: boolean;
}) {
  const initial = connection ?? {
    forge: "github",
    host: "github.com",
    label: "",
    method: "cli",
    account: "",
  };
  const [forge, setForge] = useState(initial.forge);
  const [host, setHost] = useState(initial.host);
  const [label, setLabel] = useState(initial.label);
  const [method, setMethod] = useState(initial.method);
  const [account, setAccount] = useState(initial.forge === "github" ? initial.account : "");
  const secret = useRef("");
  const secretInput = useRef<EditingTextInputHandle>(null);
  useEffect(
    () => () => {
      secret.current = "";
    },
    [],
  );
  const tea = ["gitea", "forgejo", "codeberg"].includes(forge);
  const methods = tea
    ? [{ id: "cli", label: "Saved tea login" }]
    : [{ id: "token", label: "API token" }];
  if (forge === "github") methods.unshift({ id: "cli", label: "Existing GitHub CLI account" });
  const submit = useCallback(async () => {
    const credential = secret.current;
    secret.current = "";
    secretInput.current?.replaceText("");
    await onSave({
      kind: "save",
      id: connection?.id,
      expectedRevision: connection?.revision,
      forge,
      host,
      label,
      method,
      account,
      secret: credential,
    });
  }, [onSave, connection, forge, host, label, method, account]);
  const changeProvider = useCallback((value: string) => {
    setForge(value);
    setHost(PROVIDERS.find((p) => p.id === value)!.host);
    setMethod(["github", "gitea", "forgejo", "codeberg"].includes(value) ? "cli" : "token");
    setAccount("");
    secret.current = "";
    secretInput.current?.replaceText("");
  }, []);
  const changeMethod = useCallback((value: string) => {
    setMethod(value);
    secret.current = "";
    secretInput.current?.replaceText("");
  }, []);
  const changeSecret = useCallback((value: string) => {
    secret.current = value;
  }, []);
  let submitLabel = project ? "Save and use for this project" : "Save and set as host default";
  if (connection) submitLabel = "Save connection";
  return (
    <View style={styles.form}>
      <Text style={settingsStyles.rowTitle}>
        {connection ? `Reconnect ${connection.label}` : "Add connection"}
      </Text>
      <ConnectionChoice
        label="Provider"
        value={forge}
        options={PROVIDERS}
        disabled={busy || !!connection}
        onSelect={changeProvider}
      />
      <TextInput
        accessibilityLabel="Connection name"
        placeholder="Connection name, e.g. Work"
        style={styles.input}
        initialValue={label}
        onChangeText={setLabel}
        editable={!busy}
      />
      <TextInput
        key={`host:${forge}`}
        accessibilityLabel="Git server hostname"
        placeholder="Git server, e.g. github.com"
        style={styles.input}
        initialValue={host}
        onChangeText={setHost}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy && !connection}
      />
      <ConnectionChoice
        label="Credential method"
        value={method}
        options={methods}
        disabled={busy}
        onSelect={changeMethod}
      />
      {(method === "cli" || forge === "bitbucket-cloud") && (
        <TextInput
          key={`account:${forge}`}
          accessibilityLabel={tea ? "Saved tea login name" : "Account"}
          placeholder={forge === "bitbucket-cloud" ? "Atlassian account email" : "Saved login name"}
          style={styles.input}
          initialValue={account}
          onChangeText={setAccount}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
      )}
      {method === "token" && (
        <TextInput
          ref={secretInput}
          accessibilityLabel="API token"
          placeholder="API token"
          style={styles.input}
          secureTextEntry
          onChangeText={changeSecret}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
      )}
      {method === "token" && <TokenGuide forge={forge} />}
      <Text style={settingsStyles.rowHint}>
        {method === "cli"
          ? "Uses an account already signed in on this host. Its global active account stays unchanged."
          : "The host checks the account and saves the token in its credential vault. Give the token access to the repositories you use."}
      </Text>
      <View style={styles.actions}>
        <Button size="sm" disabled={busy || !label.trim() || !host.trim()} onPress={submit}>
          {submitLabel}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onPress={onCancel}>
          Cancel
        </Button>
      </View>
    </View>
  );
}

function TokenGuide({ forge }: { forge: string }) {
  const open = useCallback(() => {
    void Linking.openURL(TOKEN_GUIDES[forge]!);
  }, [forge]);
  return (
    <Button size="sm" variant="secondary" onPress={open}>
      Create a token and check permissions
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: {
    padding: theme.spacing[4],
    gap: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  form: { gap: theme.spacing[3] },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.spacing[2] },
  identity: { flexGrow: 1, flexShrink: 1 },
  input: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    fontSize: theme.fontSize.sm,
  },
}));
