import { useCallback } from "react";
import { usePaneContext } from "@/panels/pane-context";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useHostFeature } from "@/runtime/host-features";
import type { EditorSurface } from "@/otto/editor/surface";

export function EditorHistoryItems({
  surface,
  selection = false,
}: {
  surface: EditorSurface;
  selection?: boolean;
}) {
  const pane = usePaneContext();
  const supported = useHostFeature(pane.serverId, "ottoFileHistory");
  const history = useCallback(
    () => pane.openTab({ kind: "file_history", path: surface.file }),
    [pane, surface.file],
  );
  const selectedLines = useCallback(() => {
    const range = surface.historyRange();
    if (range) pane.openTab({ kind: "file_history", path: surface.file, range });
  }, [pane, surface]);
  if (!supported || !surface.workspaceOwned) return null;
  return (
    <>
      <DropdownMenuItem onSelect={history} testID="editor-file-history">
        File History
      </DropdownMenuItem>
      {selection ? (
        <DropdownMenuItem onSelect={selectedLines}>
          File History for selected lines
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
