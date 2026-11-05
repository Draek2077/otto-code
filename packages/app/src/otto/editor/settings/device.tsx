import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  SettingsCollapsibleRow,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useAppSettings } from "@/hooks/use-settings";
import { VIM_ACTIONS, type VimAction, type EditorPreferences } from "../preferences";
import { DeviceEditorForm } from "./device-form";
import type { DeviceEditorDraft } from "./device-form";

const modes = [
  { value: "off", label: "Otto" },
  { value: "vim", label: "Vim" },
  { value: "neovim", label: "Neovim" },
  { value: "custom", label: "Custom" },
] as const;
const columns = [80, 100, 120, 140, 160, 200, 240].map((value) => ({
  value: String(value),
  label: String(value),
}));
const labels: Record<VimAction, string> = {
  save: "Save",
  find: "Find",
  goToDefinition: "Go to definition",
  findReferences: "Find references",
  renameSymbol: "Rename symbol",
  openFileSearch: "Search files",
  openChanges: "Open Changes",
  newTerminal: "New terminal",
};
function Mapping({
  action,
  value,
  model,
}: {
  action: VimAction;
  value: string;
  model: DeviceEditorForm;
}) {
  const edit = useCallback((key: string) => model.mapping(action, key), [action, model]);
  return (
    <SettingsInput label={`Space + ${labels[action]}`} initialValue={value} onChangeText={edit} />
  );
}
function DeviceForm({ model }: { model: DeviceEditorForm }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const draft = state.draft;
  const vim = useCallback((vimKeybindings: boolean) => model.edit({ vimKeybindings }), [model]);
  const ruler = useCallback((rulerEnabled: boolean) => model.edit({ rulerEnabled }), [model]);
  const column = useCallback(
    (value: string) => model.edit({ rulerColumn: Number(value) }),
    [model],
  );
  const mode = useCallback(
    (fileEditorMode: EditorPreferences["fileEditorMode"]) => model.edit({ fileEditorMode }),
    [model],
  );
  const custom = useCallback(
    (fileEditorCustomCommand: string) => model.edit({ fileEditorCustomCommand }),
    [model],
  );
  const markdown = useCallback(
    (alwaysUseOttoEditorForMarkdown: boolean) => model.edit({ alwaysUseOttoEditorForMarkdown }),
    [model],
  );
  const save = useCallback(() => void model.save(), [model]);
  const reset = useCallback(() => model.resetMappings(), [model]);
  return (
    <SettingsSection title="Editor">
      <SettingsCard>
        <SettingsSelect
          label="File editor"
          hint="Applies to newly opened file tabs. Existing terminal buffers keep their editor."
          value={draft.fileEditorMode}
          options={modes}
          onValueChange={mode}
        />
        {draft.fileEditorMode === "custom" && (
          <SettingsInput
            label="Editor command"
            initialValue={draft.fileEditorCustomCommand}
            onChangeText={custom}
          />
        )}
        <SettingsSwitch
          label="Always edit Markdown in Otto"
          value={draft.alwaysUseOttoEditorForMarkdown}
          onValueChange={markdown}
        />
        <SettingsSwitch
          label="Vim keybindings in Otto"
          value={draft.vimKeybindings}
          onValueChange={vim}
        />
        {draft.vimKeybindings && (
          <SettingsCollapsibleRow label="Vim leader mappings">
            {VIM_ACTIONS.map((action) => (
              <Mapping
                key={`${state.generation}:${action}`}
                action={action}
                value={draft.vimMappings.mappings[action] ?? ""}
                model={model}
              />
            ))}
            <SettingsRow label="Default leader mappings">
              <Button size="sm" variant="outline" onPress={reset}>
                Reset mappings
              </Button>
            </SettingsRow>
          </SettingsCollapsibleRow>
        )}
        <SettingsSwitch label="Column ruler" value={draft.rulerEnabled} onValueChange={ruler} />
        {draft.rulerEnabled && (
          <SettingsSelect
            label="Ruler column"
            value={String(draft.rulerColumn)}
            options={columns}
            onValueChange={column}
          />
        )}
        <SettingsRow label="Editor settings">
          <Button size="sm" onPress={save} disabled={!state.dirty || state.pending}>
            {state.pending ? "Saving..." : "Save"}
          </Button>
        </SettingsRow>
      </SettingsCard>
      {state.error && <Alert variant="error">{state.error}</Alert>}
    </SettingsSection>
  );
}
function OpenDeviceForm({
  settings,
  updateSettings,
}: {
  settings: DeviceEditorDraft;
  updateSettings: (draft: DeviceEditorDraft) => Promise<unknown>;
}) {
  const [model] = useState(() => new DeviceEditorForm(settings, updateSettings));
  useEffect(() => model.activate(), [model]);
  return <DeviceForm model={model} />;
}
export function OttoEditorPreferences() {
  const { settings, updateSettings, isLoading } = useAppSettings();
  if (isLoading) return <SettingsRow label="Loading editor settings..." />;
  return <OpenDeviceForm settings={settings} updateSettings={updateSettings} />;
}
