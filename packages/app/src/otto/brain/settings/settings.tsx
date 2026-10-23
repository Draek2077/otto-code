import { useCallback, useSyncExternalStore } from "react";
import { View } from "react-native";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { BrainSettingsPort, BrainSettingsStatus } from "./contracts";
import { BrainSettingsProvider, useBrainSettings, useSettingsControlSize } from "./context";
import { ConnectionSection } from "./connection-section";
import { DomainActions, DomainNotice } from "./domain-actions";
import { DefaultsSection } from "./defaults-section";
import { RuntimeStorageSection } from "./runtime-section";
import { SecuritySection } from "./security-section";
import { ValueRow } from "./fields";
import { useBrainSettingsForm } from "./use-settings-form";
import { styles } from "./styles";

const PHASES: Record<BrainSettingsStatus["phase"], { label: string; variant: StatusBadgeVariant }> =
  {
    disabled: { label: "Disabled", variant: "muted" },
    connecting: { label: "Connecting", variant: "warning" },
    unreachable: { label: "Unreachable", variant: "error" },
    stopped: { label: "Stopped", variant: "muted" },
    starting: { label: "Starting", variant: "warning" },
    running: { label: "Running", variant: "success" },
    failed: { label: "Failed", variant: "error" },
  };
const ACTIONS = { start: "Start", stop: "Stop", restart: "Restart" } as const;
const PENDING_ACTIONS = {
  start: "Starting...",
  stop: "Stopping...",
  restart: "Restarting...",
} as const;

function LifecycleAction({ action }: { action: "start" | "stop" | "restart" }) {
  const { model, state, snapshot, flushInputs, active } = useBrainSettings();
  const size = useSettingsControlSize();
  const owner = state.owner?.origin.owner;
  const perform = useCallback(() => {
    flushInputs();
    void model.perform(action, () =>
      confirmDialog({
        title: `${ACTIONS[action]} Brain?`,
        message: `${ACTIONS[action]} Brain on ${owner?.label ?? "the selected owner"} using its saved settings?`,
        confirmLabel: ACTIONS[action],
      }),
    );
  }, [action, flushInputs, model, owner]);
  if (!snapshot.capabilities.lifecycle[action]) return null;
  const disabled =
    !active ||
    !snapshot.host.connected ||
    state.operation !== null ||
    !owner ||
    state.connectionDirty ||
    state.ownerDirty ||
    state.owner?.blocked ||
    state.targetChanged;
  return (
    <Button variant="outline" size={size} onPress={perform} disabled={disabled}>
      {state.operation === action ? PENDING_ACTIONS[action] : ACTIONS[action]}
    </Button>
  );
}

function ConnectionStatus() {
  const { snapshot, port } = useBrainSettings();
  const size = useSettingsControlSize();
  const status = snapshot.status;
  const phase = PHASES[status.phase];
  return (
    <SettingsSection title="Detected Brain">
      <SettingsCard>
        <SettingsRow label="Connection">
          <StatusBadge label={phase.label} variant={phase.variant} />
        </SettingsRow>
        <ValueRow label="Brain owner" value={snapshot.owner.data?.owner.label ?? "Not reported"} />
        {status.version ? <ValueRow label="Version" value={status.version} /> : null}
        {status.endpoint ? <ValueRow label="Endpoint" value={status.endpoint} /> : null}
        {status.modelLabel ? <ValueRow label="Model" value={status.modelLabel} /> : null}
        {status.message ? <ValueRow label="Status detail" value={status.message} /> : null}
        <SettingsRow label="Use Brain">
          <View style={styles.actions}>
            <LifecycleAction action="start" />
            <LifecycleAction action="stop" />
            <LifecycleAction action="restart" />
            <Button variant="outline" size={size} onPress={port.openBrain}>
              Open Brain
            </Button>
          </View>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}

function SettingsContent() {
  const { state, snapshot } = useBrainSettings();
  return (
    <View style={styles.page}>
      {state.notice ? (
        <View style={styles.notices}>
          <Alert variant="info" description={state.notice} />
        </View>
      ) : null}
      {snapshot.connection.state === "error" && !state.connection ? (
        <Alert variant="error" description={snapshot.connection.message} />
      ) : null}
      {state.connection ? (
        <ConnectionSection />
      ) : (
        <SettingsSection title="Connection">
          <ValueRow label="Settings" value="Loading..." />
          <DomainActions scope="connection" />
        </SettingsSection>
      )}
      <ConnectionStatus />
      {snapshot.owner.state === "error" && !state.owner ? (
        <Alert variant="error" description={snapshot.owner.message} />
      ) : null}
      {state.owner ? (
        <>
          <DomainNotice scope="owner" />
          <RuntimeStorageSection />
          <DefaultsSection />
          <SecuritySection />
          <SettingsSection title={`Save settings for ${state.owner.origin.owner.label}`}>
            <DomainActions scope="owner" />
          </SettingsSection>
        </>
      ) : (
        <SettingsSection title="Brain settings">
          <ValueRow label="Owner" value="Waiting for the owning host" />
          <DomainActions scope="owner" />
        </SettingsSection>
      )}
    </View>
  );
}

function ConnectedSettings({ port, active }: { port: BrainSettingsPort; active: boolean }) {
  const snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
  const { model, state } = useBrainSettingsForm(port, snapshot, active);
  return (
    <BrainSettingsProvider
      port={port}
      snapshot={snapshot}
      model={model}
      state={state}
      active={active}
    >
      <SettingsContent />
    </BrainSettingsProvider>
  );
}

/** Parent supplies settings placement, host selection and retained-surface visibility. */
export function BrainSettings({
  port,
  active,
}: {
  port: BrainSettingsPort | null;
  active: boolean;
}) {
  if (!port) return <Alert variant="info" description="Connect a host to configure Brain" />;
  if (port.version !== 1)
    return <Alert variant="warning" description="Update the host to configure Brain" />;
  return <ConnectedSettings key={port.getSnapshot().host.serverId} port={port} active={active} />;
}
