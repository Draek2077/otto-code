import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Linking, View } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  readConnectors,
  writeConnectors,
  authorizeConnector,
  type ConnectorSummary,
  type ConnectorsSnapshot,
} from "@getpaseo/plugin/otto/connectors";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsCollapsibleRow,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { confirmDialog } from "@/utils/confirm-dialog";
import { openConnectorForm, type ConnectorForm } from "./form-model";
import { ConnectorCatalogSheet } from "./catalog-sheet";
import { ConnectorEditor } from "./editor";
import { ConnectorDetails } from "./details";

function InstalledRow({
  model,
  connection,
}: {
  model: ConnectorForm;
  connection: ConnectorSummary;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const select = useCallback(() => {
    void model.select(connection.id);
  }, [model, connection.id]);
  const enabled = connection.enabled && connection.verification.state === "verified";
  const badge = useMemo(
    () => (
      <StatusBadge
        label={enabled ? "Enabled" : connection.verification.state}
        variant={enabled ? "success" : "muted"}
        size="xs"
      />
    ),
    [enabled, connection.verification.state],
  );
  return (
    <SettingsRow
      label={connection.label}
      hint={
        connection.server.endpoint ??
        connection.server.command ??
        "Reconfigure preserved connection"
      }
      labelAccessory={badge}
    >
      <Button variant="outline" size="sm" onPress={select} disabled={state.busy || state.blocked}>
        {state.selectedId === connection.id ? "Selected" : "Manage"}
      </Button>
    </SettingsRow>
  );
}
const confirmDiscard = () =>
  confirmDialog({
    title: "Discard connection edits?",
    message: "Discard the unsaved configuration and load the host's saved connections?",
    confirmLabel: "Discard and reload",
  });
const open = (url: string) => Linking.openURL(url);
const actionsStyle = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;
function LoadedSettings({
  initial,
  hostId,
  active,
}: {
  initial: ConnectorsSnapshot;
  hostId: string;
  active: boolean;
}) {
  const read = useRpc(readConnectors);
  const write = useRpc(writeConnectors);
  const authorize = useRpc(authorizeConnector);
  const [model] = useState(() =>
    openConnectorForm(hostId, initial, { read, write, authorize, open, confirmDiscard }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    model.setActive(active);
  }, [model, active]);
  useEffect(() => () => model.close(), [model]);
  const reload = useCallback(() => {
    void model.reload();
  }, [model]);
  const refresh = useCallback(() => {
    void model.refresh();
  }, [model]);
  const actions = useMemo(
    () => (
      <View style={actionsStyle}>
        <Button
          variant="outline"
          size="sm"
          onPress={refresh}
          disabled={state.busy || state.blocked || Boolean(state.draft)}
        >
          Refresh
        </Button>
        <Button size="sm" onPress={model.showCatalog} disabled={state.busy || state.blocked}>
          Add connector
        </Button>
      </View>
    ),
    [model, refresh, state.busy, state.blocked, state.draft],
  );
  return (
    <>
      <SettingsSection
        title="Installed connections"
        trailing={actions}
        info="Connect accounts and MCP servers once on this host, then use the same tools from all supported agent providers. Only add servers and accounts you trust."
      >
        {state.error ? <Alert variant="error" description={state.error} /> : null}
        {state.notice ? <Alert variant="info" description={state.notice} /> : null}
        <SettingsCard>
          {state.snapshot.connectors.length ? (
            state.snapshot.connectors.map((connection) => (
              <InstalledRow key={connection.id} model={model} connection={connection} />
            ))
          ) : (
            <SettingsRow
              label="No connectors yet"
              hint="Add an account or a custom MCP server to get started."
            />
          )}
        </SettingsCard>
        {state.blocked ? (
          <SettingsCard>
            <SettingsRow label="Connection changes could not be confirmed">
              <Button variant="outline" size="sm" onPress={reload} disabled={state.busy}>
                Reload saved settings
              </Button>
            </SettingsRow>
          </SettingsCard>
        ) : null}
        <ConnectorEditor model={model} />
        <ConnectorDetails model={model} />
      </SettingsSection>
      {state.snapshot.connectors.length > 0 ? (
        <SettingsCard>
          <SettingsCollapsibleRow label="Connector tool availability">
            {state.snapshot.providers.map((provider) => (
              <SettingsRow
                key={provider.id}
                label={provider.label}
                hint={provider.reason ?? undefined}
              >
                <StatusBadge
                  label={provider.available ? "Available" : "Tools disabled"}
                  variant={provider.available ? "success" : "muted"}
                  size="xs"
                />
              </SettingsRow>
            ))}
          </SettingsCollapsibleRow>
        </SettingsCard>
      ) : null}
      <ConnectorCatalogSheet model={model} />
    </>
  );
}
function HostSettings({ hostId, active }: { hostId: string; active: boolean }) {
  const read = useRpc(readConnectors);
  const [initial, setInitial] = useState<ConnectorsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!active || initial) return;
    let current = true;
    void read({ hostId })
      .then((result) => {
        if (current) {
          if (result.ok) setInitial(result.value);
          else setError(result.error.message);
        }
        return undefined;
      })
      .catch(() => {
        if (current) setError("The host could not read Connectors.");
      });
    return () => {
      current = false;
    };
  }, [read, hostId, active, initial, attempt]);
  if (initial) return <LoadedSettings initial={initial} hostId={hostId} active={active} />;
  return (
    <SettingsCard>
      <SettingsRow label={error || "Loading Connectors…"} error={error || null}>
        {error ? (
          <Button variant="outline" size="sm" onPress={retry}>
            Retry
          </Button>
        ) : null}
      </SettingsRow>
    </SettingsCard>
  );
}
export function ConnectorHostSettings(props: PluginSurfaceProps) {
  return (
    <View>
      <HostSettings key={props.host.id} hostId={props.host.id} active={props.active !== false} />
    </View>
  );
}
