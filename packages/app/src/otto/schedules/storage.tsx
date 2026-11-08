import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { View, Text } from "react-native";
import { SettingsSection, SettingsCard, SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { ScheduleApi } from "./api";
import { ScheduleStorageModel } from "./storage-model";
import { ScheduleChoice } from "./fields";
import { styles } from "./styles";
import { useScheduleActivity } from "./activity";
const LOCATIONS = [
  { value: "repository", label: "Repository" },
  { value: "host", label: "Owning host" },
];
const PROJECT = [{ value: "", label: "Use Schedules host default" }, ...LOCATIONS];
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
  const saveHost = useCallback(() => model.saveDefault(), [model]);
  const saveProject = useCallback(() => model.saveProject(), [model]);
  const disabled = lane.busy || lane.blocked;
  return (
    <View style={styles.contentGap}>
      <SettingsSection title="Schedules storage">
        <SettingsCard>
          <SettingsRow label="New schedules only">
            <Text style={styles.muted}>
              Schedules has its own default and project override. Repository schedules belong to the
              project; host-local schedules remain and execute on this owning host. Changing a
              setting never moves existing records.
            </Text>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      {state.defaults && showDefault ? (
        <>
          <ScheduleChoice
            label="Schedules host default"
            value={state.defaultDraft}
            options={LOCATIONS}
            change={host}
            disabled={disabled}
          />
          <Button
            variant="outline"
            onPress={saveHost}
            disabled={disabled || state.defaultDraft === state.defaults.location}
          >
            Save host default
          </Button>
        </>
      ) : null}
      {state.storage ? (
        <>
          <Text
            style={styles.muted}
          >{`${state.storage.hostLabel} · ${state.storage.projectLabel}`}</Text>
          <ScheduleChoice
            label="Schedules project override"
            value={state.projectDraft ?? ""}
            options={PROJECT}
            change={project}
            disabled={disabled}
          />
          <Button
            variant="outline"
            onPress={saveProject}
            disabled={disabled || state.projectDraft === state.storage.override}
          >
            Save project override
          </Button>
        </>
      ) : null}
      <Button variant="ghost" onPress={reload} disabled={lane.busy}>
        Reload storage settings
      </Button>
      {lane.error ? <Alert variant="error" description={lane.error} /> : null}
      {lane.message ? <Alert description={lane.message} /> : null}
    </View>
  );
}
