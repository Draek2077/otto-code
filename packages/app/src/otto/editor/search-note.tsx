import { useState, useMemo, useCallback } from "react";
import { Text } from "react-native";
import { Button } from "@/components/ui/button";
import { DocumentNoteEditor } from "./markdown/annotations";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import type { EditorSearchPort } from "./workspace-ports";
import type { EditorSearchResult } from "@getpaseo/plugin/otto/editor";
import type { EditorContextAttachment } from "./context-attachment";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";

/** Search notes capture only the host-returned source window, never an invented
 * diff hunk. They coexist with Changes and document review attachments. */
export function EditorSearchNote({
  surface,
  match,
}: {
  surface: EditorSearchPort;
  match: EditorSearchResult["matches"][number];
}) {
  const { hostId, root, workspaceId } = surface.contextScope;
  const scope = buildWorkspaceAttachmentScopeKey({ serverId: hostId, cwd: root, workspaceId });
  const id = JSON.stringify(["search", match.file, match.line, match.column, match.preview]);
  const note = useWorkspaceAttachmentsStore((store) =>
    store.attachmentsByScope[scope]?.find(
      (item): item is EditorContextAttachment => item.kind === "editor_context" && item.id === id,
    ),
  );
  const [open, setOpen] = useState(false),
    active = useRetainedPanelActive(),
    visible = useAppVisible();
  const target = useMemo(
    () => ({ title: `${match.file}:${match.line}`, excerpt: match.preview }),
    [match],
  );
  const show = useCallback(() => setOpen(true), []),
    close = useCallback(() => setOpen(false), []);
  const save = useCallback(
    (_target: typeof target, text: string) => {
      const column = Math.max(0, match.column - 1 - 60);
      useWorkspaceAttachmentsStore.getState().addWorkspaceAttachment({
        scopeKey: scope,
        attachment: {
          kind: "editor_context",
          id,
          file: match.file,
          locator: "source",
          note: text,
          excerpt: match.preview,
          range: {
            start: { line: match.line - 1, character: column },
            end: { line: match.line - 1, character: column + match.preview.length },
          },
        },
      });
    },
    [scope, id, match],
  );
  const remove = useCallback(() => {
    const store = useWorkspaceAttachmentsStore.getState();
    store.setWorkspaceAttachments({
      scopeKey: scope,
      attachments: (store.attachmentsByScope[scope] ?? []).filter(
        (item) => item.kind !== "editor_context" || item.id !== id,
      ),
    });
  }, [scope, id]);
  return (
    <>
      <Button variant="ghost" size="xs" onPress={show}>
        {note ? "Edit search note" : "Comment on result"}
      </Button>
      {note ? <Text numberOfLines={3}>{note.note}</Text> : null}
      {open && active && visible ? (
        <DocumentNoteEditor
          target={target}
          initial={note?.note ?? ""}
          save={save}
          remove={remove}
          close={close}
        />
      ) : null}
    </>
  );
}
