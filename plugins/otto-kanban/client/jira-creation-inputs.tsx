import { useEffect, useMemo, useSyncExternalStore } from "react";
import { SettingsButton, SettingsRow, SettingsSelect } from "@getpaseo/plugin/client/ui";
import type { JiraCreationDraft } from "./jira-creation-draft.js";

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
      ...(state.options?.projects ?? []).map((row) => ({ value: row.id, label: row.label })),
    ],
    [state.options],
  );
  const types = useMemo(
    () => [
      { value: "", label: "Choose an issue type" },
      ...(state.options?.issueTypes ?? []).map((row) => ({ value: row.id, label: row.label })),
    ],
    [state.options],
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
