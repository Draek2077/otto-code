import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { SettingsSection, SettingsCard, SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { ScheduleApi } from "./api";
import { ScheduleStorageModel } from "./storage-model";
import { styles } from "./styles";
import { useScheduleActivity } from "./activity";
const LOCATIONS = [
  { value: "repository", label: "Project folder" },
  { value: "host", label: "This host" },
];
const PROJECT = [{ value: "", label: "Use host default" }, ...LOCATIONS];
export function ScheduleStorage({
  api,
  hostId,
  projectId,
  showDefault = true,
}: {
  api: ScheduleApi;
  hostId: string;
  projectId: string | null;
  showDefault?: boolean;
}) {
  const active = useScheduleActivity();
  const [model] = useState(() => new ScheduleStorageModel(api, hostId, projectId));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    lane = useSyncExternalStore(model.lane.subscribe, model.lane.getSnapshot);
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const host = useCallback(
    (value: string) => {
      if (value === "host" || value === "repository") model.default(value);
    },
    [model],
  );
  const project = useCallback(
    (value: string) => {
      if (value === "host" || value === "repository" || value === "") model.project(value || null);
    },
    [model],
  );
  const reload = useCallback(
    () =>
      model.reload(() =>
        confirmDialog({
          title: "Reload Schedules storage settings?",
          message:
            "Replace local choices with the current saved settings? Existing records remain at their original locations.",
          confirmLabel: "Reload",
        }),
      ),
    [model],
  );
  const disabled = !state.defaults || lane.blocked;
  return (
    <View style={styles.contentGap}>
      <SettingsSection
        title="Schedules storage"
        info="Choose where new schedules are saved. Existing schedules stay where they are."
      >
        <SettingsCard>
          {state.defaults && showDefault ? (
            <SettingsSelect
              label="Default location"
              value={state.defaultDraft}
              options={LOCATIONS}
              onValueChange={host}
              disabled={disabled}
            />
          ) : null}
          {state.storage ? (
            <SettingsSelect
              label="Save new schedules in"
              value={state.projectDraft ?? ""}
              options={PROJECT}
              onValueChange={project}
              disabled={disabled}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
      {lane.error || lane.blocked ? (
        <>
          <Button variant="ghost" onPress={reload} disabled={lane.busy}>
            Reload saved settings
          </Button>
          {lane.error ? <Alert variant="error" description={lane.error} /> : null}
        </>
      ) : null}
    </View>
  );
}
