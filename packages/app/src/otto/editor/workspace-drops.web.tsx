import { useEffect, useRef } from "react";
import { getDesktopHost } from "@/desktop/host";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useToast } from "@/contexts/toast-context";
import {
  WORKSPACE_FILE_DRAG_MIME,
  parseWorkspaceFileDragPayload,
  resolveWorkspaceFileDrop,
} from "@/attachments/workspace-file-drag";
import type { WorkspaceEditorDropsProps } from "./workspace-drops";
function preservesDrop(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        '[data-testid="otto-composer-drop-target"], [data-testid="terminal-surface"], [data-otto-editor-language="markdown"], [role="dialog"]',
      ),
    )
  );
}
/** Workspace drops open files; Composer, Markdown assets and terminal insertion
 * retain their existing, more specific contracts. */
export function WorkspaceEditorDrops(props: WorkspaceEditorDropsProps) {
  const root = useRef<HTMLDivElement>(null);
  const local = useIsLocalDaemon(props.serverId),
    toast = useToast();
  const live = useRef({ props, local, toast });
  live.current = { props, local, toast };
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const accepts = (event: DragEvent) =>
      live.current.props.active &&
      !preservesDrop(event.target) &&
      [...(event.dataTransfer?.types ?? [])].some(
        (type) => type === "Files" || type === WORKSPACE_FILE_DRAG_MIME,
      );
    const over = (event: DragEvent) => {
      if (accepts(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const drop = (event: DragEvent) => {
      if (!accepts(event) || !event.dataTransfer) return;
      event.preventDefault();
      event.stopPropagation();
      const { props: current, local: isLocal, toast: messages } = live.current;
      const serialized = event.dataTransfer.getData(WORKSPACE_FILE_DRAG_MIME);
      if (serialized) {
        const payload = parseWorkspaceFileDragPayload(serialized);
        const attachment = payload
          ? resolveWorkspaceFileDrop({
              payload,
              serverId: current.serverId,
              workspaceId: current.workspaceId,
            })
          : null;
        if (attachment)
          current.openFile({
            path: attachment.path,
            ...(attachment.selection.kind === "line_range"
              ? { lineStart: attachment.selection.startLine, lineEnd: attachment.selection.endLine }
              : {}),
          });
        else messages.error("This file belongs to a different host or workspace. Open it there.");
        return;
      }
      const bridge = getDesktopHost()?.webUtils;
      if (!isLocal || !bridge?.getPathForFile) {
        messages.error(
          "This drop cannot expose a file path on the selected host. Use its Files panel, or attach the file in the Composer.",
        );
        return;
      }
      for (const file of [...event.dataTransfer.files].slice(0, 16)) {
        const path = bridge.getPathForFile(file);
        if (path) current.openFile({ path });
      }
    };
    node.addEventListener("dragover", over, true);
    node.addEventListener("drop", drop, true);
    return () => {
      node.removeEventListener("dragover", over, true);
      node.removeEventListener("drop", drop, true);
    };
  }, []);
  return (
    <div ref={root} style={style}>
      {props.children}
    </div>
  );
}
const style = { display: "flex", flex: 1, minHeight: 0, minWidth: 0 } as const;
