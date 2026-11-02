import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text } from "react-native";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { settingsStyles } from "@/styles/settings";
import {
  readTerminalSettings,
  saveTerminalSettings,
  diagnoseTerminal,
  type TerminalCheck,
  type TerminalPreferences,
} from "@getpaseo/plugin/otto/terminal";
import { TerminalForm, type TerminalSettingsPort } from "./form";

function DiagnosticRow({ check }: { check: TerminalCheck }) {
  return (
    <SettingsRow
      label={`${check.status.toUpperCase()} · ${check.label}`}
      hint={check.detail}
      testID={`terminal-check-${check.id}`}
    />
  );
}
function TerminalSettingsForm({ port }: { port: TerminalSettingsPort }) {
  const [model] = useState(() => new TerminalForm(port));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => model.activate(), [model]);
  const autoTitle = useCallback(
    (enabled: boolean) => model.edit({ terminalTitleMode: enabled ? "auto" : "default" }),
    [model],
  );
  const paths = useCallback(
    (enabled: boolean) => model.edit({ terminalTitleIncludePaths: enabled }),
    [model],
  );
  const shell = useCallback(
    (value: TerminalPreferences["defaultTerminalShell"]) =>
      model.edit({ defaultTerminalShell: value }),
    [model],
  );
  const save = useCallback(() => {
    void model.save();
  }, [model]);
  const diagnose = useCallback(() => {
    void model.diagnose();
  }, [model]);
  const reload = useCallback(async () => {
    const accepted = await confirmDialog({
      title: "Reload terminal settings?",
      message: "Unsaved terminal preferences will be discarded.",
      confirmLabel: "Reload",
    });
    if (accepted) await model.reload();
  }, [model]);
  const shells = useMemo(
    () =>
      (state.data?.shells ?? []).map((choice) => ({
        value: choice.id,
        label: choice.available ? choice.label : `${choice.label} (unavailable)`,
      })),
    [state.data?.shells],
  );
  const selected = state.draft;
  const disabled = state.phase !== "ready";
  if (state.phase === "loading") return <SettingsRow label="Loading terminal settings..." />;
  return (
    <SettingsSection title="Terminal preferences">
      {state.error ? (
        <Alert variant="error" title="Terminal settings unavailable" description={state.error}>
          <Button variant="outline" size="sm" onPress={reload}>
            Reload settings
          </Button>
        </Alert>
      ) : null}
      {selected ? (
        <SettingsCard>
          <SettingsSwitch
            label="Automatic titles"
            hint="Show the active shell or command. Turn off to keep the default terminal name."
            value={selected.terminalTitleMode === "auto"}
            onValueChange={autoTitle}
            disabled={disabled}
          />
          <SettingsSwitch
            label="Include paths in titles"
            value={selected.terminalTitleIncludePaths}
            onValueChange={paths}
            disabled={disabled || selected.terminalTitleMode !== "auto"}
          />
          {state.data?.platform === "win32" ? (
            <SettingsSelect
              label="Default shell"
              value={selected.defaultTerminalShell}
              options={shells}
              onValueChange={shell}
              disabled={disabled}
            />
          ) : null}
          <SettingsRow
            label="New terminal sessions"
            hint="Existing sessions and explicit command profiles keep their current settings."
          >
            <Button
              size="sm"
              variant="outline"
              onPress={save}
              disabled={disabled}
              loading={state.phase === "saving"}
            >
              Save preferences
            </Button>
          </SettingsRow>
        </SettingsCard>
      ) : null}
      {state.saved ? (
        <Text style={settingsStyles.rowHint} accessibilityLiveRegion="polite">
          Terminal preferences saved
        </Text>
      ) : null}
      <SettingsCard>
        <SettingsRow
          label="Compatibility check"
          hint="Check host tools, PTY resize and alternate-screen behavior. No tools or user configuration are installed or changed."
          error={state.diagnosticError ?? undefined}
        >
          <Button
            variant="outline"
            size="sm"
            onPress={diagnose}
            loading={state.diagnosticPending}
            disabled={state.diagnosticPending}
          >
            Test compatibility
          </Button>
        </SettingsRow>
      </SettingsCard>
      {state.diagnostic ? (
        <SettingsCard>
          {state.diagnostic.checks.map((check) => (
            <DiagnosticRow key={check.id} check={check} />
          ))}
        </SettingsCard>
      ) : null}
    </SettingsSection>
  );
}
export function OttoTerminalSettings({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  // COMPAT(ottoTerminal): added v0.10.0, remove gate after 2027-05-02 when host floor >= v0.10.0.
  const supported = useHostFeature(serverId, "ottoTerminal");
  const port = useMemo<TerminalSettingsPort | null>(() => {
    if (!client || !connected || !supported) return null;
    const invoke = (method: string, input: unknown) =>
      client.invokePluginRpc("otto-terminal", method, input);
    return {
      read: async () =>
        readTerminalSettings.output.parse(
          await invoke(readTerminalSettings.name, { hostId: serverId }),
        ),
      save: async (expectedRevision, patch) =>
        saveTerminalSettings.output.parse(
          await invoke(saveTerminalSettings.name, { hostId: serverId, expectedRevision, patch }),
        ),
      diagnose: async () =>
        diagnoseTerminal.output.parse(await invoke(diagnoseTerminal.name, { hostId: serverId })),
    };
  }, [client, connected, serverId, supported]);
  if (!connected) return <SettingsRow label="Connect the host to manage terminal preferences" />;
  if (!port) return <SettingsRow label="Update the host to use Otto terminal preferences" />;
  return <TerminalSettingsForm key={serverId} port={port} />;
}
