import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { SquareTerminal } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { Alert } from "@/components/ui/alert";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { commitTypes, type ManualCommitDraft, type CommitType } from "./manual-commit";
import { CommitCheckbox, useManualCommitDraft } from "./commit-context";

const options = commitTypes.map((value) => ({ id: value, value, label: value }));
const logHeader = { title: "Commit console log" };
const ConsoleIcon = withUnistyles(SquareTerminal, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
function CommitForm({ model, connected }: { model: ManualCommitDraft; connected: boolean }) {
  const input = useRef<EditingTextInputHandle>(null);
  const [showLog, setShowLog] = useState(false);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const edit = useCallback((message: string) => model.edit({ message }), [model]);
  const choose = useCallback((type: CommitType) => model.edit({ type }), [model]);
  const commit = useCallback(async () => {
    if (await model.submit()) input.current?.replaceText("");
  }, [model]);
  const toggleAll = useCallback(() => model.toggleAll(), [model]);
  const openLog = useCallback(() => setShowLog(true), []);
  const closeLog = useCallback(() => setShowLog(false), []);
  const selected = state.files.filter((file) => !state.excluded.has(file.path)).length;
  let checked: boolean | "mixed" = selected > 0;
  if (selected > 0 && selected < state.files.length) checked = "mixed";
  const display = useMemo(() => ({ label: `Type ${state.type}` }), [state.type]);
  return (
    <View style={styles.section} testID="changes-manual-commit">
      <View style={styles.typeRow}>
        <SelectField
          label="Commit type"
          value={state.type}
          selectedDisplay={display}
          options={options}
          onChange={choose}
          placeholder="Type none"
          emptyText="No commit types"
          field={false}
          size="sm"
          triggerTestID="changes-commit-type-selector"
        />
      </View>
      <FormTextInput
        ref={input}
        initialValue={state.message}
        onChangeText={edit}
        placeholder="Commit message"
        accessibilityLabel="Commit message"
        multiline
        size="sm"
        style={styles.message}
        testID="changes-commit-message"
      />
      <View style={styles.row}>
        <View style={styles.selection}>
          <CommitCheckbox
            checked={checked}
            onPress={toggleAll}
            disabled={state.pending}
            label="Select all changed files"
            testID="changes-commit-select-all"
          />
          <Text style={styles.count} numberOfLines={1}>
            {selected} of {state.files.length} files selected
          </Text>
        </View>
        <View style={styles.actions}>
          <ToolbarButton
            label="Commit console log"
            onPress={openLog}
            testID="changes-commit-log-button"
          >
            <ConsoleIcon size={16} />
          </ToolbarButton>
          <Button
            size="sm"
            variant="default"
            onPress={commit}
            disabled={!connected || state.pending || !selected || !state.message.trim()}
            loading={state.pending}
            testID="changes-commit-button"
          >
            Commit
          </Button>
        </View>
      </View>
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      <AdaptiveModalSheet visible={showLog} onClose={closeLog} header={logHeader}>
        <ScrollView>
          <Text selectable style={styles.log}>
            {state.output || "No manual commit has run in this view."}
          </Text>
        </ScrollView>
      </AdaptiveModalSheet>
    </View>
  );
}
export function ManualCommitSection({ serverId }: { serverId: string }) {
  const model = useManualCommitDraft();
  const connected = useHostRuntimeIsConnected(serverId);
  return model ? <CommitForm model={model} connected={connected} /> : null;
}
const styles = StyleSheet.create((theme) => ({
  section: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    borderTopWidth: 1,
    borderColor: theme.colors.border,
    flexShrink: 0,
  },
  typeRow: { flexDirection: "row" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  selection: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], flexShrink: 0 },
  message: { minHeight: 64, maxHeight: 160, textAlignVertical: "top" },
  count: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base, flexShrink: 1 },
  log: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
}));
