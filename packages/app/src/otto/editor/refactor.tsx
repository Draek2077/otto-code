import { useState, useCallback, useMemo, useSyncExternalStore, useEffect } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { usePaneContext } from "@/panels/pane-context";
import { useDraftStore } from "@/stores/draft-store";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { EditorRefactorForm } from "./refactor-form";
import type { EditorSurface } from "./surface";

export function useEditorRefactor(surface: EditorSurface, active: boolean) {
  const pane = usePaneContext();
  const [form, setForm] = useState<EditorRefactorForm | null>(null);
  const close = useCallback(() => setForm(null), []);
  useEffect(() => {
    if (!active) setForm(null);
  }, [active]);
  const open = useCallback(() => {
    const scope = surface.refactorScope();
    if (active && scope) setForm(new EditorRefactorForm(scope));
  }, [surface, active]);
  const submit = useCallback(() => {
    if (!active || !form) return;
    form.submit((text) => {
      const draftId = generateDraftId();
      useDraftStore.getState().saveDraftInput({
        draftKey: buildDraftStoreKey({ serverId: pane.serverId, agentId: draftId, draftId }),
        draft: { text, attachments: [] },
      });
      pane.openTab({ kind: "draft", draftId });
      close();
    });
  }, [active, form, pane, close]);
  const dialog =
    form && active ? <RefactorDialog form={form} submit={submit} close={close} /> : null;
  return { open, dialog };
}
function RefactorDialog({
  form,
  submit,
  close,
}: {
  form: EditorRefactorForm;
  submit(): void;
  close(): void;
}) {
  const draft = useSyncExternalStore(form.subscribe, form.getSnapshot);
  const header = useMemo(() => ({ title: "Refactor with AI", subtitle: form.scope.path }), [form]);
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button size="sm" variant="outline" onPress={close}>
          Cancel
        </Button>
        <Button size="sm" onPress={submit} disabled={!draft.instruction.trim()}>
          Open request draft
        </Button>
      </View>
    ),
    [close, submit, draft.instruction],
  );
  return (
    <AdaptiveModalSheet
      visible
      header={header}
      footer={footer}
      onClose={close}
      testID="editor-refactor"
    >
      <Text style={styles.text}>
        {form.scope.lineStart
          ? `Selection: lines ${form.scope.lineStart}-${form.scope.lineEnd}`
          : "Scope: whole file"}
      </Text>
      {form.scope.selectedCode ? (
        <Text style={styles.code} numberOfLines={8}>
          {form.scope.selectedCode}
        </Text>
      ) : null}
      <FormTextInput
        initialValue={draft.instruction}
        onChangeText={form.edit}
        multiline
        maxLength={10000}
        accessibilityLabel="Refactor instruction"
      />
      <Alert variant="info">
        This opens a guarded chat draft. Review the provider, model and request before sending. No
        agent runs and no file changes here.
      </Alert>
      {draft.error ? <Alert variant="error">{draft.error}</Alert> : null}
    </AdaptiveModalSheet>
  );
}
const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  text: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[2],
  },
  code: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    marginBottom: theme.spacing[3],
  },
}));
