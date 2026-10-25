import { useEffect, useMemo, useSyncExternalStore } from "react";
import { SettingsButton, SettingsRow, SettingsSelect } from "@getpaseo/plugin/client/ui";
import type { JiraCreationDraft } from "./jira-creation-draft.js";
function capturedChoices(choices: { id: string; label: string }[], id: string, label: string) {
  const options = choices.map((row) => ({ value: row.id, label: row.label }));
  if (id && label && !options.some((row) => row.value === id)) options.push({ value: id, label });
  return options;
}

export function JiraCreationInputs({
  draft,
  disabled,
}: {
  draft: JiraCreationDraft;
  disabled: boolean;
}) {
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  useEffect(() => draft.activate(), [draft]);
  const projects = useMemo(
    () => [
      { value: "", label: "Choose a Jira project" },
      ...capturedChoices(state.options?.projects ?? [], state.projectId, state.projectLabel),
    ],
    [state.options, state.projectId, state.projectLabel],
  );
  const types = useMemo(
    () => [
      { value: "", label: "Choose an issue type" },
      ...capturedChoices(state.options?.issueTypes ?? [], state.issueTypeId, state.issueTypeLabel),
    ],
    [state.options, state.issueTypeId, state.issueTypeLabel],
  );
  return (
    <>
      <SettingsSelect
        label="Jira project"
        value={state.projectId}
        options={projects}
        onValueChange={draft.selectProject}
        disabled={disabled || state.busy}
      />
      <SettingsSelect
        label="Issue type"
        value={state.issueTypeId}
        options={types}
        onValueChange={draft.selectType}
        disabled={disabled || state.busy || !state.projectId}
      />
      {state.busy ? <SettingsRow label="Reading Jira's creation screen..." /> : null}
      {state.options?.message ? <SettingsRow label={state.options.message} /> : null}
      {state.error ? (
        <SettingsRow label="Creation choices unavailable" error={state.error} />
      ) : null}
      <SettingsButton onPress={draft.reload} variant="outline" disabled={disabled || state.busy}>
        Reload creation choices
      </SettingsButton>
    </>
  );
}
