import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
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
import type { Result } from "../shared/model.js";
import type { TargetFormModel } from "./target-form.js";

const actionsStyle = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;
const providerOptions = [
  { label: "GitHub Projects", value: "github" },
  { label: "Jira", value: "jira" },
];

export function TargetForm({
  model,
  read,
  active,
}: {
  model: TargetFormModel;
  active: boolean;
  read(binding: ProjectConfiguration["binding"]): Promise<Result<ProjectConfiguration>>;
}) {
  const [confirmReload, setConfirmReload] = useState(false);
  useEffect(() => (active ? model.activate() : undefined), [model, active]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const requestReload = useCallback(() => setConfirmReload(true), []);
  const keepEditing = useCallback(() => setConfirmReload(false), []);
  const reload = useCallback(async () => {
    setConfirmReload(false);
    await model.reload(read);
  }, [model, read]);
  return (
    <SettingsSection title="Project board settings" testID="kanban-project-settings">
      <SettingsCard>
        <SettingsSwitch
          label="Configure a board for this project"
          value={state.enabled}
          onValueChange={model.setEnabled}
        />
        {state.enabled ? (
          <>
            <SettingsSelect
              label="Provider"
              value={state.adapter}
              options={providerOptions}
              onValueChange={model.setAdapter}
            />
            <SettingsInput
              key={`${state.adapter}/${state.generation}`}
              label="Board number or URL"
              initialValue={state.boardId}
              onChangeText={model.setBoardId}
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
                    key={state.generation}
                    label="Board owner"
                    initialValue={state.boardOwner}
                    onChangeText={model.setBoardOwner}
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
        {state.reloadRequired ? (
          <View style={actionsStyle}>
            <SettingsButton variant="outline" onPress={requestReload} disabled={state.busy}>
              Reload saved settings
            </SettingsButton>
          </View>
        ) : null}
        {confirmReload ? (
          <View>
            <SettingsRow label="Discard unsaved board settings and reload?" />
            <View style={actionsStyle}>
              <SettingsButton onPress={keepEditing}>Keep editing</SettingsButton>
              <SettingsButton variant="outline" onPress={reload}>
                Discard and reload
              </SettingsButton>
            </View>
          </View>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
