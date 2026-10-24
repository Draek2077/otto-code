import { useCallback, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  SettingsButton,
  SettingsCard,
  SettingsExpander,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import type { ProjectConfiguration } from "../shared/model.js";
import { setProjectTarget } from "../shared/rpc.js";
import { openTargetForm } from "./target-form.js";

const actionsStyle = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;
const providerOptions = [
  { label: "GitHub Projects", value: "github" },
  { label: "Jira", value: "jira" },
];

export function TargetForm({
  snapshot,
  onSaved,
  onCancel,
  onReload,
}: {
  snapshot: ProjectConfiguration;
  onSaved(configuration: ProjectConfiguration): void;
  onCancel(): void;
  onReload(): void;
}) {
  const write = useRpc(setProjectTarget);
  const [model] = useState(() => openTargetForm({ snapshot, save: write }));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const save = useCallback(async () => {
    const result = await model.save();
    if (result) onSaved(result);
  }, [model, onSaved]);
  return (
    <SettingsSection title="Project board settings">
      <SettingsCard>
        <SettingsSwitch
          label="Configure a board for this project"
          value={state.enabled}
          onValueChange={model.setEnabled}
          disabled={state.busy}
        />
        {state.enabled ? (
          <>
            <SettingsSelect
              label="Provider"
              value={state.adapter}
              options={providerOptions}
              onValueChange={model.setAdapter}
              disabled={state.busy}
            />
            <SettingsInput
              key={state.adapter}
              label="Board number or URL"
              initialValue={state.boardId}
              onChangeText={model.setBoardId}
              disabled={state.busy}
              placeholder={
                state.adapter === "github"
                  ? "https://github.com/orgs/example/projects/1"
                  : "Jira board ID or URL"
              }
            />
            {state.adapter === "github" ? (
              <SettingsExpander label="Advanced">
                {!state.boardId.startsWith("https://") ? (
                  <SettingsInput
                    label="Board owner"
                    initialValue={state.boardOwner}
                    onChangeText={model.setBoardOwner}
                    disabled={state.busy}
                  />
                ) : null}
                <SettingsRow label="An empty board identifier discovers boards linked to this project's GitHub repository." />
              </SettingsExpander>
            ) : (
              <SettingsRow label="Jira board reading requires the shared Atlassian host integration." />
            )}
            <SettingsRow
              label={
                state.adapter === "github"
                  ? "GitHub CLI owns sign-in on the selected host."
                  : "The host owns the shared Atlassian credentials. This field stores only the board identifier."
              }
            />
          </>
        ) : null}
        {state.error ? <SettingsRow label="Settings were not saved" error={state.error} /> : null}
        <View style={actionsStyle}>
          <SettingsButton onPress={save} disabled={state.busy || !state.dirty}>
            {state.busy ? "Saving..." : "Save"}
          </SettingsButton>
          <SettingsButton variant="outline" onPress={onCancel} disabled={state.busy}>
            Cancel
          </SettingsButton>
          {state.errorCode === "revision_conflict" ? (
            <SettingsButton variant="outline" onPress={onReload} disabled={state.busy}>
              Discard changes and reload
            </SettingsButton>
          ) : null}
        </View>
      </SettingsCard>
    </SettingsSection>
  );
}
