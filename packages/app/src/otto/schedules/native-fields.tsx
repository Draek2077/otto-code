import { useEffect, useState, useSyncExternalStore } from "react";
import type { ScheduleSummary } from "@getpaseo/protocol/schedule/types";
import { ScheduleTargetFields } from "@/components/schedules/schedule-form-sheet";
import { useScheduleFormProviderSnapshot } from "@/schedules/use-schedule-form-provider-snapshot";
import { openScheduleForm } from "@/schedules/schedule-form-model";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import type { ScheduleProjectTarget } from "@/schedules/schedule-project-targets";
import type { ScheduleEditorModel } from "./editor-model";
import type { ScheduleTargetModel } from "./target-model";
import { useScheduleActivity } from "./activity";
export interface ScheduleProjectChoice {
  projectId: string;
  label: string;
  target: ScheduleProjectTarget;
  supportsWorkspaceMultiplicity: boolean;
  workspaces: { value: string; label: string }[];
}
/** Reuse the native form's real provider/catalog resolution. There is no second
 * list of provider defaults or a Schedule-specific agent launcher. */
export function ScheduleNativeFields({
  editor,
  target,
  project,
}: {
  editor: ScheduleEditorModel;
  target: ScheduleTargetModel;
  project: ScheduleProjectChoice;
}) {
  const { preferences } = useFormPreferences();
  const active = useScheduleActivity();
  const [model] = useState(() => {
    const document = editor.getSnapshot().document,
      candidate = editor.getSnapshot().candidate;
    let schedule: ScheduleSummary | undefined;
    if (document && candidate?.type === "new-agent")
      schedule = { ...document.schedule, target: candidate };
    const opened = openScheduleForm({
      mode: schedule ? "edit" : "create",
      schedule,
      hosts: [
        {
          serverId: editor.scope.hostId,
          label: project.target.serverName,
          supportsWorkspaceMultiplicity: project.supportsWorkspaceMultiplicity,
        },
      ],
      defaults: {
        serverId: editor.scope.hostId,
        projectTargets: [project.target],
        timezone: "UTC",
        preferences,
      },
    });
    if (!schedule) opened.setProject(project.target.optionId, { label: project.label });
    return opened;
  });
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const providerSnapshot = useScheduleFormProviderSnapshot(model, state, active);
  const compact = useIsCompactFormFactor();
  useEffect(() => model.applyPreferences(preferences), [model, preferences]);
  useEffect(() => () => model.close(), [model]);
  useEffect(() => {
    let previous = "";
    const apply = () => {
      const value = model.getState();
      const { selectedProvider, selectedModel, workingDir } = value;
      const config = {
        provider: selectedProvider,
        model: selectedModel,
        cwd: workingDir,
        modeId: value.selectedMode || undefined,
        thinkingOptionId: value.selectedThinkingOptionId || undefined,
        ...(value.submitIsolation !== undefined ? { isolation: value.submitIsolation } : {}),
        ...(value.submitArchiveOnFinish !== undefined
          ? { archiveOnFinish: value.submitArchiveOnFinish }
          : {}),
      };
      const fingerprint = JSON.stringify(config);
      if (fingerprint === previous) return;
      previous = fingerprint;
      if (!selectedProvider || !selectedModel || !workingDir) {
        target.native(null, "New agent");
        return;
      }
      const original = editor.getSnapshot().candidate;
      const preserved = original?.type === "new-agent" ? original.config : {};
      target.native(
        { type: "new-agent", config: { ...preserved, ...config, provider: selectedProvider } },
        `${value.selectedModelDisplay?.label ?? selectedModel} · ${value.selectedModeDisplay.label}`,
      );
    };
    apply();
    return model.subscribe(apply);
  }, [editor, model, target]);
  return (
    <ScheduleTargetFields
      model={model}
      state={state}
      providerSnapshot={providerSnapshot}
      agentTargetLabel={null}
      controlSize={compact ? "md" : "sm"}
      mutationServerId={editor.scope.hostId}
      scopeLocked
    />
  );
}
