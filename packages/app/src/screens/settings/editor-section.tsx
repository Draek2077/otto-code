import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { Shortcut } from "@/components/ui/shortcut";
import { Switch } from "@/components/ui/switch";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { getIsElectron, isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppSettings } from "@/hooks/use-settings";
import { settingsStyles } from "@/styles/settings";
import {
  DEFAULT_VIM_MAPPING_SETTINGS,
  normalizeVimMappingSettings,
  VIM_ACTIONS,
  type VimMappingAction,
} from "@/editor/vim-mappings";
import type { FileEditorMode } from "@/editor/external-file-editor";
import { SettingsSection } from "./settings-section";

const VIM_ACTION_LABELS: Record<VimMappingAction, string> = {
  save: "Save",
  find: "Find",
  goToDefinition: "Go to definition",
  findReferences: "Find references",
  renameSymbol: "Rename symbol",
  openFileSearch: "File search",
  openChanges: "Changes",
  newTerminal: "New terminal",
};

const FILE_EDITOR_OPTIONS: SelectFieldOption<FileEditorMode>[] = [
  { id: "file-editor-off", value: "off", label: "Otto" },
  { id: "file-editor-vim", value: "vim", label: "Vim" },
  { id: "file-editor-neovim", value: "neovim", label: "Neovim" },
  { id: "file-editor-custom", value: "custom", label: "Custom" },
];

function VimMappingRow({
  action,
  value,
  isCapturing,
  capturedMapping,
  onStartCapture,
  onDoneCapture,
  onCancelCapture,
  onReset,
}: {
  action: VimMappingAction;
  value: string;
  isCapturing: boolean;
  capturedMapping: string;
  onStartCapture: (action: VimMappingAction) => void;
  onDoneCapture: () => void;
  onCancelCapture: () => void;
  onReset: (action: VimMappingAction) => void;
}) {
  const displayMapping = isCapturing ? capturedMapping : value;
  const chord = useMemo(
    () => [["Space"], ...displayMapping.split("").map((key) => [key])],
    [displayMapping],
  );
  const handleStartCapture = useCallback(() => onStartCapture(action), [action, onStartCapture]);
  const isDefault = value === DEFAULT_VIM_MAPPING_SETTINGS.mappings[action];
  const handleReset = useCallback(() => onReset(action), [action, onReset]);
  return (
    <View style={styles.mappingRow} testID={`vim-mapping-${action}`}>
      <Text style={styles.mappingLabel}>{VIM_ACTION_LABELS[action]}</Text>
      <View style={styles.mappingControls}>
        {displayMapping ? (
          <View testID={`vim-mapping-${action}-value`}>
            <Shortcut chord={chord} />
          </View>
        ) : null}
        {isCapturing && capturedMapping ? (
          <Button size="sm" variant="ghost" onPress={onDoneCapture}>
            Done
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onPress={isCapturing ? onCancelCapture : handleStartCapture}
        >
          {isCapturing ? "Cancel" : "Rebind"}
        </Button>
        {!isDefault && !isCapturing ? (
          <Button size="sm" variant="ghost" onPress={handleReset}>
            Reset
          </Button>
        ) : null}
      </View>
    </View>
  );
}

export function EditorSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const [capturingAction, setCapturingAction] = useState<VimMappingAction | null>(null);
  const [capturedMapping, setCapturedMapping] = useState("");
  const vimMappings = useMemo(
    () => normalizeVimMappingSettings(settings.vimMappings),
    [settings.vimMappings],
  );
  const isCompact = useIsCompactFormFactor();
  const desktop = getIsElectron() && !isCompact;
  const externalEditorDisplay = useMemo(
    () => ({
      label:
        FILE_EDITOR_OPTIONS.find((option) => option.value === settings.fileEditorMode)?.label ??
        "Otto",
    }),
    [settings.fileEditorMode],
  );
  const handleChange = useCallback(
    (vimKeybindings: boolean) => void updateSettings({ vimKeybindings }),
    [updateSettings],
  );
  const handleMappingChange = useCallback(
    (action: VimMappingAction, value: string) => {
      const mappings = { ...vimMappings.mappings, [action]: value };
      for (const otherAction of VIM_ACTIONS) {
        if (otherAction !== action && mappings[otherAction] === value) {
          delete mappings[otherAction];
        }
      }
      void updateSettings({
        vimMappings: normalizeVimMappingSettings({
          leader: "Space",
          mappings,
        }),
      });
    },
    [updateSettings, vimMappings.mappings],
  );
  const cancelMappingCapture = useCallback(() => {
    setCapturedMapping("");
    setCapturingAction(null);
  }, []);
  const startMappingCapture = useCallback((action: VimMappingAction) => {
    setCapturedMapping("");
    setCapturingAction(action);
  }, []);
  const commitMappingCapture = useCallback(() => {
    if (capturingAction === null || !capturedMapping) {
      return;
    }
    handleMappingChange(capturingAction, capturedMapping);
    cancelMappingCapture();
  }, [cancelMappingCapture, capturedMapping, capturingAction, handleMappingChange]);
  const resetMapping = useCallback(
    (action: VimMappingAction) =>
      handleMappingChange(action, DEFAULT_VIM_MAPPING_SETTINGS.mappings[action] ?? ""),
    [handleMappingChange],
  );
  const handleExternalEditorModeChange = useCallback(
    (value: FileEditorMode) => void updateSettings({ fileEditorMode: value }),
    [updateSettings],
  );
  const handleExternalEditorCommandChange = useCallback(
    (value: string) => void updateSettings({ fileEditorCustomCommand: value }),
    [updateSettings],
  );
  useEffect(() => {
    if (isNative || capturingAction === null) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key;
      if (key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelMappingCapture();
        return;
      }
      if (key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        setCapturedMapping((current) => current.slice(0, -1));
        return;
      }
      if (key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commitMappingCapture();
        return;
      }
      if (!/^[A-Za-z0-9]$/u.test(key)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setCapturedMapping((current) => (current.length < 2 ? `${current}${key}` : current));
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [cancelMappingCapture, capturingAction, commitMappingCapture]);

  useEffect(() => {
    if (!settings.vimKeybindings) {
      cancelMappingCapture();
    }
  }, [cancelMappingCapture, settings.vimKeybindings]);
  useEffect(() => {
    if (JSON.stringify(settings.vimMappings) !== JSON.stringify(vimMappings)) {
      void updateSettings({ vimMappings });
    }
  }, [settings.vimMappings, updateSettings, vimMappings]);
  return (
    <>
      <SettingsSection title={t("settings.editor.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.editor.vimKeybindings")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.editor.vimHint")}</Text>
            </View>
            <Switch
              value={settings.vimKeybindings}
              onValueChange={handleChange}
              accessibilityLabel={t("settings.editor.vimKeybindings")}
              testID="vim-keybindings-toggle"
            />
          </View>
        </View>
      </SettingsSection>

      {settings.vimKeybindings ? (
        <SettingsSection title="Vim shortcuts">
          <View style={settingsStyles.card}>
            <View style={settingsStyles.row}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>Leader</Text>
                <Text style={settingsStyles.rowHint}>
                  Press Space, then a shortcut key in Vim normal mode
                </Text>
              </View>
              <Shortcut keys={["Space"]} />
            </View>
            {VIM_ACTIONS.map((action) => (
              <VimMappingRow
                key={action}
                action={action}
                value={vimMappings.mappings[action] ?? ""}
                isCapturing={capturingAction === action}
                capturedMapping={capturingAction === action ? capturedMapping : ""}
                onStartCapture={startMappingCapture}
                onDoneCapture={commitMappingCapture}
                onCancelCapture={cancelMappingCapture}
                onReset={resetMapping}
              />
            ))}
          </View>
        </SettingsSection>
      ) : null}

      {desktop ? (
        <SettingsSection title="File editor">
          <View style={settingsStyles.card} testID="external-file-editor-settings">
            <View style={settingsStyles.rowResponsive}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>File editor</Text>
                <Text style={settingsStyles.rowHint}>
                  New source files open in the selected editor. Vim and Neovim run on the Otto host
                  in the File Editor terminal.
                </Text>
              </View>
              <SelectField<FileEditorMode>
                label="File editor"
                value={settings.fileEditorMode}
                selectedDisplay={externalEditorDisplay}
                options={FILE_EDITOR_OPTIONS}
                onChange={handleExternalEditorModeChange}
                placeholder="Otto"
                emptyText="No editor modes"
                size="sm"
                field={false}
                triggerStyle={styles.externalEditorModeTrigger}
                testID="external-file-editor-mode"
                triggerTestID="external-file-editor-mode-trigger"
              />
            </View>
            {settings.fileEditorMode === "custom" ? (
              <View style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}>
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>Command</Text>
                  <Text style={settingsStyles.rowHint}>
                    Use an executable and any required arguments
                  </Text>
                </View>
                <FormTextInput
                  size="sm"
                  value={settings.fileEditorCustomCommand}
                  onChangeText={handleExternalEditorCommandChange}
                  placeholder="editor --wait"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Custom file editor command"
                  testID="external-file-editor-command"
                  style={styles.externalEditorInput}
                />
              </View>
            ) : null}
          </View>
        </SettingsSection>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  mappingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  mappingLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexGrow: 1,
    flexShrink: 1,
  },
  mappingControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  externalEditorModeTrigger: {
    width: 180,
  },
  externalEditorInput: {
    width: 240,
    fontFamily: theme.fontFamily.mono,
  },
}));
