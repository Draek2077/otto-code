import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsRow, SettingsSelect, SettingsSwitch } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/utils/confirm-dialog";
import { GitFetchForm } from "./form";
import type { GitFetchPort } from "./port";
import { useGitFetchPort } from "./use-port";
import {
  GIT_FETCH_INTERVALS,
  GitFetchPreferencesSchema,
} from "@getpaseo/plugin/otto/workspace-git";

const intervals = GIT_FETCH_INTERVALS.map((seconds) => ({
  value: String(seconds),
  label: seconds === 3600 ? "1 hour" : `${seconds / 60} minutes`,
}));
function GitFetchSettingsForm({ port }: { port: GitFetchPort }) {
  const [model] = useState(() => new GitFetchForm(port));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => model.activate(), [model]);
  const enabled = useCallback((value: boolean) => model.edit({ enabled: value }), [model]);
  const interval = useCallback(
    (value: string) => {
      const intervalSeconds = GitFetchPreferencesSchema.shape.intervalSeconds.parse(Number(value));
      model.edit({ intervalSeconds });
    },
    [model],
  );
  const save = useCallback(() => {
    void model.save();
  }, [model]);
  const reload = useCallback(() => {
    void model.reload(() =>
      confirmDialog({
        title: "Reload Git fetch settings?",
        message: "Unsaved Git fetch preferences will be discarded.",
        confirmLabel: "Reload",
      }),
    );
  }, [model]);
  const disabled = state.phase !== "ready";
  return (
    <SettingsCard testID="otto-git-fetch-settings">
      {state.draft ? (
        <SettingsSwitch
          label="Automatic Git fetch"
          value={state.draft.enabled}
          onValueChange={enabled}
          disabled={disabled}
        />
      ) : (
        <SettingsRow
          label="Git fetch"
          hint={state.phase === "loading" ? "Loading settings..." : undefined}
        />
      )}
      {state.draft ? (
        <SettingsSelect
          label="Fetch interval"
          value={String(state.draft.intervalSeconds)}
          options={intervals}
          onValueChange={interval}
          disabled={disabled || !state.draft.enabled}
        />
      ) : null}
      {state.notice ? (
        <SettingsRow
          label={state.phase === "blocked" ? "Git fetch settings unavailable" : "Git fetch"}
          error={state.phase === "blocked" ? state.notice : undefined}
          hint={state.phase === "blocked" ? undefined : state.notice}
          testID="otto-git-fetch-notice"
        />
      ) : null}
      <SettingsRow label="Git fetch settings">
        <View style={styles.actions}>
          <Button
            size="sm"
            variant="outline"
            onPress={reload}
            disabled={state.phase === "loading" || state.phase === "saving"}
          >
            Reload
          </Button>
          <Button size="sm" onPress={save} disabled={disabled || !state.dirty}>
            {state.phase === "saving" ? "Saving..." : "Save"}
          </Button>
        </View>
      </SettingsRow>
    </SettingsCard>
  );
}
const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
export function OttoGitFetchSettings({ serverId }: { serverId: string }) {
  const { port, connected } = useGitFetchPort(serverId);
  if (!connected) return <SettingsRow label="Connect the host to manage Git fetch" />;
  if (!port) return <SettingsRow label="Update the host to manage Git fetch" />;
  return <GitFetchSettingsForm key={serverId} port={port} />;
}
