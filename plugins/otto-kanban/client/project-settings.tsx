import { useCallback, useEffect, useState } from "react";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { SettingsButton, SettingsCard, SettingsRow } from "@getpaseo/plugin/client/ui";
import type { ProjectConfiguration } from "../shared/model.js";
import { getProjectConfiguration, setProjectTarget } from "../shared/rpc.js";
import { ProjectTargetDrafts } from "./target-drafts.js";
import { TargetForm } from "./target-form-view.js";
import { useRead } from "./use-read.js";

function OpenProjectForm({
  snapshot,
  drafts,
}: {
  snapshot: ProjectConfiguration;
  drafts: ProjectTargetDrafts;
}) {
  const write = useRpc(setProjectTarget);
  const read = useRpc(getProjectConfiguration);
  const [model] = useState(() => drafts.open(snapshot, write));
  useEffect(() => drafts.retain(model), [drafts, model]);
  return <TargetForm model={model} read={read} />;
}

export function KanbanProjectSettings({
  drafts,
  ...props
}: PluginScreenProps & {
  drafts: ProjectTargetDrafts;
}) {
  const read = useRpc(getProjectConfiguration);
  const projectId = props.params.projectId ?? "";
  const valid = props.params.projectHostId === props.host.id && Boolean(projectId);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const load = useCallback(
    () => read({ hostId: props.host.id, projectId }),
    [read, props.host.id, projectId],
  );
  const state = useRead({
    key: JSON.stringify([props.host.id, projectId, attempt]),
    enabled: valid,
    load,
    errorMessage: "Project board settings could not be loaded.",
  });
  if (!valid) return <SettingsRow label="Open Kanban from this project's Project Settings." />;
  if (state.status === "ready" && state.value.ok)
    return (
      <OpenProjectForm
        key={JSON.stringify([props.host.id, projectId])}
        snapshot={state.value.value}
        drafts={drafts}
      />
    );
  let error = "";
  if (state.status === "error") error = state.message;
  else if (state.status === "ready" && !state.value.ok) error = state.value.error.message;
  return (
    <SettingsCard>
      <SettingsRow
        label={error ? "Kanban settings unavailable" : "Loading Kanban settings..."}
        error={error || null}
      />
      {error ? <SettingsButton onPress={retry}>Retry</SettingsButton> : null}
    </SettingsCard>
  );
}
