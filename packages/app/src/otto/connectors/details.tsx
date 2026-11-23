import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { ConnectorSummary } from "@getpaseo/plugin/otto/connectors";
import {
  SettingsCard,
  SettingsCollapsibleRow,
  SettingsRow,
  SettingsSwitch,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { SearchField } from "@/components/ui/search-field";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import type { ConnectorForm } from "./form-model";

function ToolRow({
  model,
  connection,
  tool,
}: {
  model: ConnectorForm;
  connection: ConnectorSummary;
  tool: ConnectorSummary["verification"]["tools"][number];
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const change = useCallback(
    (enabled: boolean) => {
      const disabled = new Set(connection.disabledTools);
      if (enabled) disabled.delete(tool.name);
      else disabled.add(tool.name);
      void model.mutate({ kind: "tools", id: connection.id, disabledTools: [...disabled] });
    },
    [model, connection.disabledTools, connection.id, tool.name],
  );
  return (
    <SettingsSwitch
      label={tool.name}
      hint={tool.description}
      value={!connection.disabledTools.includes(tool.name)}
      onValueChange={change}
      disabled={state.busy || state.blocked}
    />
  );
}
function ToolAccess({ model, connection }: { model: ConnectorForm; connection: ConnectorSummary }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const change = useCallback((value: string) => {
    setQuery(value);
    setLimit(50);
  }, []);
  const more = useCallback(() => setLimit((value) => value + 50), []);
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return connection.verification.tools.filter((tool) =>
      `${tool.name} ${tool.description}`.toLowerCase().includes(text),
    );
  }, [query, connection.verification.tools]);
  return (
    <SettingsCard>
      <SettingsCollapsibleRow label={`Tool access (${connection.verification.tools.length})`}>
        <SettingsRow
          label="Per-tool access"
          hint="Disable individual actions here. Disabling takes effect before the next dispatch; an operation already sent to the provider cannot be recalled."
        />
        <SettingsRow label="Find tools">
          <SearchField
            value={query}
            onChangeText={change}
            placeholder="Search tools"
            clearAccessibilityLabel="Clear tool search"
          />
        </SettingsRow>
        {filtered.slice(0, limit).map((tool) => (
          <ToolRow key={tool.name} model={model} connection={connection} tool={tool} />
        ))}
        {filtered.length > limit ? (
          <SettingsRow label={`Showing ${limit} of ${filtered.length} tools`}>
            <Button variant="outline" size="sm" onPress={more}>
              Show more tools
            </Button>
          </SettingsRow>
        ) : null}
        {filtered.length === 0 ? <SettingsRow label="No matching tools" /> : null}
      </SettingsCollapsibleRow>
    </SettingsCard>
  );
}
function ConnectionActions({
  model,
  connection,
}: {
  model: ConnectorForm;
  connection: ConnectorSummary;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const enable = useCallback(
    (enabled: boolean) => {
      void model.mutate({ kind: "enable", id: connection.id, enabled });
    },
    [model, connection.id],
  );
  const verify = useCallback(() => {
    void model.mutate({ kind: "verify", id: connection.id });
  }, [model, connection.id]);
  const disconnect = useCallback(async () => {
    if (
      await confirmDialog({
        title: "Disconnect this account?",
        message:
          "Stop this connection's tools and remove its saved authorization. Your provider account and content are kept.",
        confirmLabel: "Disconnect",
        destructive: true,
      })
    )
      await model.mutate({ kind: "disconnect", id: connection.id });
  }, [model, connection.id]);
  const remove = useCallback(async () => {
    if (
      await confirmDialog({
        title: "Remove connector?",
        message:
          "Remove this connection and its tool access from Otto. This does not delete content in the provider account.",
        confirmLabel: "Remove connector",
        destructive: true,
      })
    )
      await model.mutate({ kind: "remove", id: connection.id });
  }, [model, connection.id]);
  const connect = useCallback(() => {
    void model.connect();
  }, [model]);
  const disabled = state.busy || state.blocked;
  return (
    <SettingsCard>
      <SettingsSwitch
        label="Enable tools"
        hint="Available to supported agent providers when their Otto tools are enabled. Existing chats may need a tool refresh or a new chat."
        value={connection.enabled}
        onValueChange={enable}
        disabled={disabled || connection.verification.state !== "verified"}
      />
      <SettingsRow
        label="Configuration"
        hint={
          connection.server.endpoint ??
          connection.server.command ??
          "Preserved configuration unavailable"
        }
      >
        <Button variant="outline" size="sm" onPress={model.editConnection} disabled={disabled}>
          Edit connection
        </Button>
      </SettingsRow>
      {connection.authorization.state !== "not-required" ? (
        <SettingsRow
          label="Account"
          hint={
            connection.authorization.account ??
            connection.authorization.message ??
            "Sign in to grant access to this connection."
          }
        >
          <Button
            size="sm"
            onPress={connect}
            disabled={disabled || connection.authorization.state === "pending"}
          >
            Connect account
          </Button>
          <Button variant="outline" size="sm" onPress={disconnect} disabled={disabled}>
            Disconnect
          </Button>
        </SettingsRow>
      ) : null}
      <SettingsRow
        label="Verification"
        hint={
          connection.verification.message ??
          `${connection.verification.toolCount ?? connection.verification.tools.length} tools discovered. ${connection.verification.state}`
        }
      >
        <Button variant="outline" size="sm" onPress={verify} disabled={disabled}>
          Verify connection
        </Button>
      </SettingsRow>
      <SettingsRow label="Remove connection">
        <Button variant="outline" size="sm" onPress={remove} disabled={disabled}>
          Remove
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
export function ConnectorDetails({ model }: { model: ConnectorForm }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const reopen = useCallback(() => {
    void model.reopenConsent();
  }, [model]);
  const copyLink = useCallback(() => {
    if (state.authorizationUrl) void copyToClipboard(state.authorizationUrl);
  }, [state.authorizationUrl]);
  const connection = state.snapshot.detail;
  if (!connection || state.draft) return null;
  return (
    <>
      <ConnectionActions model={model} connection={connection} />
      {state.authorizationUrl ? (
        <SettingsCard>
          <SettingsRow
            label="Complete sign-in"
            hint={
              state.callback === "hosted"
                ? "You can finish this sign-in in a browser on this device."
                : "This sign-in returns to the daemon's local callback. Open the link in a browser on the computer running this host, not on a different phone or computer."
            }
          >
            <Button variant="outline" size="sm" onPress={reopen}>
              Open sign-in
            </Button>
            <Button variant="outline" size="sm" onPress={copyLink}>
              Copy sign-in link
            </Button>
          </SettingsRow>
        </SettingsCard>
      ) : null}
      {connection.authorization.state === "error" ? (
        <Alert
          variant="warning"
          description={connection.authorization.message ?? "Reconnect this account."}
        />
      ) : null}
      {connection.verification.tools.length ? (
        <ToolAccess model={model} connection={connection} />
      ) : null}
    </>
  );
}
