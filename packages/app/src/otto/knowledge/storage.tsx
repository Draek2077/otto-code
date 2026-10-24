import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  setKnowledgeLocation,
  type KnowledgeCatalog,
  type KnowledgeScope,
} from "@getpaseo/plugin/otto/project-knowledge";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { KnowledgeLocationModel } from "./location-model";
import { styles } from "./styles";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
const options = [
  { value: "repository", label: "Repository" },
  { value: "host", label: "Host" },
];
function StorageEditor({
  scope,
  settings,
  onSaved,
  onCancel,
}: {
  scope: KnowledgeScope;
  settings: KnowledgeCatalog["settings"];
  onSaved(): void;
  onCancel(): void;
}) {
  const saveLocation = useRpc(setKnowledgeLocation);
  const [model] = useState(
    () =>
      new KnowledgeLocationModel(settings, async (location, expectedRevision) => {
        const result = await saveLocation({ scope, location, expectedRevision });
        return result.ok ? { ok: true } : { ok: false, message: result.error.message };
      }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    model.activate();
    return () => model.close();
  }, [model]);
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  useEffect(() => model.setActive(retained && visible), [model, retained, visible]);
  const select = useCallback(
    (value: string) => {
      if (value === "repository" || value === "host") model.select(value);
    },
    [model],
  );
  const save = useCallback(async () => {
    const authority = model.getAuthority();
    if (
      !(await confirmDialog({
        title: "Change Knowledge storage?",
        message:
          "Otto will copy and verify the existing store before changing this project's setting. The original store remains available for recovery.",
        confirmLabel: "Copy and switch",
      }))
    )
      return;
    if (await model.save(authority)) onSaved();
  }, [model, onSaved]);
  return (
    <>
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      <SettingsSelect
        label="Store location"
        value={state.location}
        options={options}
        onValueChange={select}
        disabled={state.busy}
      />
      <View style={styles.actions}>
        <Button onPress={onCancel} disabled={state.busy} variant="outline">
          Cancel
        </Button>
        <Button onPress={save} disabled={state.busy || state.blocked}>
          {state.busy ? "Copying..." : "Save storage"}
        </Button>
      </View>
    </>
  );
}
export function KnowledgeStorage({
  scope,
  settings,
  onChanged,
}: {
  scope: KnowledgeScope;
  settings: KnowledgeCatalog["settings"];
  onChanged(): void;
}) {
  const [editing, setEditing] = useState(false);
  const open = useCallback(() => setEditing(true), []);
  const close = useCallback(() => setEditing(false), []);
  const saved = useCallback(() => {
    setEditing(false);
    onChanged();
  }, [onChanged]);
  return (
    <SettingsSection title="Project Knowledge settings">
      <SettingsCard>
        <SettingsRow label="Owning project" hint={settings.label} />
        <SettingsRow label="Current store" hint={`${settings.location}: ${settings.path}`} />
        {editing ? (
          <StorageEditor scope={scope} settings={settings} onSaved={saved} onCancel={close} />
        ) : (
          <SettingsRow label="Storage">
            <Button variant="outline" size="sm" onPress={open}>
              Change storage
            </Button>
          </SettingsRow>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
