import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import {
  readKnowledgeHostDefaults,
  saveKnowledgeHostDefaults,
} from "@getpaseo/plugin/otto/project-knowledge";
import { SettingsCard, SettingsSection, SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { KnowledgeHostDefaultModel } from "./host-default-model";

const options = [
  { value: "repository", label: "Repository" },
  { value: "host", label: "Host" },
];
export function KnowledgeHostDefaults({ hostId, active }: { hostId: string; active: boolean }) {
  const read = useRpc(readKnowledgeHostDefaults);
  const save = useRpc(saveKnowledgeHostDefaults);
  const cache = useQueryClient();
  const [model] = useState(
    () =>
      new KnowledgeHostDefaultModel({
        read: () => read({ hostId }),
        save: (input) => save({ hostId, ...input }),
        changed: () => {
          void cache.invalidateQueries({ queryKey: ["ottoKnowledge", hostId] });
        },
      }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    model.activate();
    return () => model.close();
  }, [model]);
  useEffect(() => model.setActive(active), [model, active]);
  const select = useCallback(
    (value: string) => {
      if (value === "repository" || value === "host") model.select(value);
    },
    [model],
  );
  const reload = useCallback(async () => {
    const authority = model.getAuthority();
    if (
      (state.blocked || state.location !== state.origin?.defaultStoreLocation) &&
      !(await confirmDialog({
        title: "Reload host default?",
        message:
          "Discard this local selection and read the saved default from the selected host? Existing Knowledge stays unchanged.",
        confirmLabel: "Reload default",
      }))
    )
      return;
    await model.reload(authority);
  }, [model, state.blocked, state.location, state.origin]);
  return (
    <SettingsSection title="Host Knowledge defaults" testID="knowledge-host-defaults">
      <SettingsCard>
        <SettingsSelect
          label="New store location"
          hint="Changes where new stores are created on this host. Existing stores stay where they are."
          value={state.location}
          options={options}
          onValueChange={select}
          disabled={!state.origin || state.busy || state.blocked || !active}
        />
      </SettingsCard>
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.error ? (
        <Button variant="outline" size="sm" onPress={reload} disabled={!active || state.busy}>
          Reload default
        </Button>
      ) : null}
    </SettingsSection>
  );
}
