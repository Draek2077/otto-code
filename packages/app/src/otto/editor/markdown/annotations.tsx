import { useCallback, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { usePaneContext } from "@/panels/pane-context";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
import type { EditorContextAttachment } from "../context-attachment";
import type { MarkdownNoteTarget } from "./annotation-source";
const EMPTY: readonly WorkspaceComposerAttachment[] = [];
export function useDocumentNotes(file: string, workspaceRoot?: string) {
  const pane = usePaneContext();
  const resolved = resolveWorkspaceFilePaths({ path: file, workspaceRoot: workspaceRoot ?? "" });
  const owned = Boolean(resolved?.relativePath);
  const identity = resolved?.relativePath ?? file;
  const scopeKey = buildWorkspaceAttachmentScopeKey({
    serverId: pane.serverId,
    workspaceId: pane.workspaceId,
    cwd: workspaceRoot ?? "",
  });
  const attachments = useWorkspaceAttachmentsStore(
    (store) => store.attachmentsByScope[scopeKey] ?? EMPTY,
  );
  const notes = useMemo(
    () =>
      attachments.filter(
        (value): value is EditorContextAttachment =>
          value.kind === "editor_context" &&
          value.file === identity &&
          value.locator === "markdown-heading",
      ),
    [attachments, identity],
  );
  const noteFor = useCallback(
    (target: MarkdownNoteTarget) =>
      notes.find(
        (note) => note.id === JSON.stringify([identity, "heading", target.from, target.excerpt]),
      ),
    [notes, identity],
  );
  const save = useCallback(
    (target: MarkdownNoteTarget, note: string) => {
      if (!owned) return;
      useWorkspaceAttachmentsStore.getState().addWorkspaceAttachment({
        scopeKey,
        attachment: {
          kind: "editor_context",
          id: JSON.stringify([identity, "heading", target.from, target.excerpt]),
          file: identity,
          range: target.range,
          excerpt: target.excerpt,
          note,
          locator: "markdown-heading",
        },
      });
    },
    [owned, scopeKey, identity],
  );
  const remove = useCallback(
    (target: MarkdownNoteTarget) => {
      const store = useWorkspaceAttachmentsStore.getState(),
        id = noteFor(target)?.id;
      store.setWorkspaceAttachments({
        scopeKey,
        attachments: (store.attachmentsByScope[scopeKey] ?? EMPTY).filter(
          (value) => value.kind !== "editor_context" || value.id !== id,
        ),
      });
    },
    [scopeKey, noteFor],
  );
  return { owned, noteFor, save, remove };
}
export function DocumentNoteEditor<T extends { title: string; excerpt: string }>({
  target,
  initial,
  save,
  remove,
  close,
}: {
  target: T;
  initial: string;
  save(target: T, note: string): void;
  remove(target: T): void;
  close(): void;
}) {
  const [value, setValue] = useState(initial);
  const submit = useCallback(() => {
    if (value.trim()) {
      save(target, value.trim());
      close();
    }
  }, [value, save, target, close]);
  const discard = useCallback(() => {
    remove(target);
    close();
  }, [remove, target, close]);
  const header = useMemo(
    () => ({ title: "Document review note", subtitle: target.title }),
    [target.title],
  );
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        {initial ? (
          <Button variant="destructive" size="sm" onPress={discard}>
            Delete
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onPress={close}>
          Cancel
        </Button>
        <Button size="sm" onPress={submit} disabled={!value.trim()}>
          Save note
        </Button>
      </View>
    ),
    [initial, discard, close, submit, value],
  );
  return (
    <AdaptiveModalSheet
      visible
      header={header}
      onClose={close}
      footer={footer}
      testID="editor-document-note"
    >
      <Text style={styles.excerpt} numberOfLines={4}>
        {target.excerpt}
      </Text>
      <FormTextInput
        initialValue={initial}
        onChangeText={setValue}
        multiline
        accessibilityLabel="Document review note"
        maxLength={10000}
      />
    </AdaptiveModalSheet>
  );
}
const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  excerpt: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    marginBottom: theme.spacing[3],
  },
}));
