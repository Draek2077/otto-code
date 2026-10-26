import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { View, type TextStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { useRpc } from "@getpaseo/plugin/client";
import {
  readContextSourceFile,
  saveContextSourceFile,
  type ContextSelection,
} from "@getpaseo/plugin/otto/context-management";
import { SettingsRow, SettingsSection } from "@/components/settings";
import { FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import type { ContextEdgeEdit, ContextEdgeEditState } from "./edge-edit";
import { ContextSourceDrafts, contextLineSelection, type ContextSourceModel } from "./source-model";
import type { ContextSourceSelection } from "./selection";
import { styles } from "./styles";

function SourceInput({
  model,
  disabled,
  focus,
  inputStyle,
}: {
  model: ContextSourceModel;
  disabled: boolean;
  focus: { start: number; end: number } | null;
  inputStyle?: TextStyle;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const input = useRef<EditingTextInputHandle>(null);
  const focused = useRef(false);
  const compact = useIsCompactFormFactor();
  const edit = useCallback((text: string) => model.setText(text), [model]);
  useLayoutEffect(() => {
    if (!focus || disabled || focused.current) return;
    focused.current = true;
    input.current?.focus();
    input.current?.setSelection(focus);
  }, [disabled, focus]);
  return (
    <FormTextInput
      ref={input}
      initialValue={state.text}
      onChangeText={edit}
      editable={!disabled}
      accessibilityLabel="Current context source"
      testID="context-source-editor-input"
      multiline
      autoCorrect={false}
      autoCapitalize="none"
      spellCheck={false}
      size={compact ? "md" : "sm"}
      style={inputStyle}
    />
  );
}
const ThemedSourceInput = withUnistyles(SourceInput);
const sourceInputStyle = (theme: Theme) => ({
  inputStyle: {
    minHeight: 320,
    textAlignVertical: "top" as const,
    fontFamily: theme.fontFamily.mono,
    backgroundColor: theme.colors.terminal.background,
    color: theme.colors.foreground,
  },
});
interface EditorProps {
  scope: ContextSelection;
  selection: ContextSourceSelection & { nodeId: string };
  drafts: ContextSourceDrafts;
  active: boolean;
  writeModel: ContextEdgeEdit;
  writeState: ContextEdgeEditState;
  onChanged(): void;
}
export function ContextSourceEditor({
  scope,
  selection,
  drafts,
  active,
  writeModel,
  writeState,
  onChanged,
}: EditorProps) {
  const read = useRpc(readContextSourceFile),
    save = useRpc(saveContextSourceFile);
  const [model] = useState(() =>
    drafts.open(JSON.stringify([scope.agentId, selection.nodeId]), {
      async read() {
        const result = await read({ ...scope, nodeId: selection.nodeId });
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      },
      async save(input) {
        const result = await save({
          ...scope,
          nodeId: selection.nodeId,
          ...input,
          userApprovedSave: true,
        });
        if (!result.ok) return { ok: false, message: result.error.message };
        return { ok: true, revision: result.value.revision };
      },
    }),
  );
  useLayoutEffect(() => (active ? model.activate() : undefined), [active, model]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const focus = useMemo(
    () =>
      state.file && selection.sourceRevision === state.file.revision && selection.line
        ? contextLineSelection(state.file.text, selection.line, selection.lineEnd ?? selection.line)
        : null,
    [selection.line, selection.lineEnd, selection.sourceRevision, state.file],
  );
  const submit = useCallback(
    () =>
      model.save(
        writeModel,
        (global) =>
          confirmDialog({
            title: global ? "Change this host-wide source?" : "Save current context source?",
            message: global
              ? "This source is shared across projects on this host. Saving can change instructions for other projects and future provider reads. Captured requests and conversation history stay unchanged."
              : "Save the reviewed current file on its owning host. Future instruction reads may change; captured requests and conversation history stay unchanged.",
            confirmLabel: "Save source",
          }),
        onChanged,
      ),
    [model, writeModel, onChanged],
  );
  const reload = useCallback(
    () =>
      model.reload(() =>
        confirmDialog({
          title: "Discard this source draft?",
          message: "Replace the local draft with the current file from its owning host?",
          confirmLabel: "Discard and reload",
        }),
      ),
    [model],
  );
  const disabled = !active || state.reading || state.writing || writeState.busy;
  return (
    <SettingsSection
      title={state.file?.label ?? "Current source"}
      info="Current file on the owning host, separate from captured prompt text."
    >
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.reading ? <SettingsRow label="Reading current source..." /> : null}
      {state.file ? (
        <>
          {state.file.readOnlyReason ? (
            <Alert variant="info" description={state.file.readOnlyReason} />
          ) : null}
          {selection.findingId && !focus ? (
            <Alert
              variant="info"
              description="The finding's source revision differs from this current file. Its old line range was not selected."
            />
          ) : null}
          <ThemedSourceInput
            key={state.inputVersion}
            model={model}
            disabled={disabled || !state.file.writable}
            focus={focus}
            uniProps={sourceInputStyle}
          />
        </>
      ) : null}
      <View style={styles.actions}>
        <Button
          variant="default"
          size="sm"
          onPress={submit}
          disabled={disabled || writeState.blocked || !state.file?.writable || !state.dirty}
        >
          Save source
        </Button>
        <Button variant="outline" size="sm" onPress={reload} disabled={disabled}>
          Reload current source
        </Button>
      </View>
    </SettingsSection>
  );
}
