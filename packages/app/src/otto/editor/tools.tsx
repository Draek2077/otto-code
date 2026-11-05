import { useCallback, useState, useSyncExternalStore } from "react";
import { Text } from "react-native";
import { Code2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuHint,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import type { EditorSurface } from "./surface";
import { EditorShortcutMenuItem } from "./shortcuts/menu-item";
import { EditorExportItems } from "./document-tools";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";

const Icon = withUnistyles(Code2);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
function dialogsAvailable(available: boolean, retained: boolean, visible: boolean) {
  return available && retained && visible;
}
export function EditorTools({
  surface,
  available,
  state,
}: {
  surface: EditorSurface;
  available: boolean;
  state: string;
}) {
  const snapshot = useSyncExternalStore(surface.subscribe, surface.getSnapshot);
  const retained = useRetainedPanelActive(),
    visible = useAppVisible();
  const canShowDialog = dialogsAvailable(available, retained, visible);
  const [dismissed, setDismissed] = useState(0);
  const [searching, setSearching] = useState(false);
  const openSymbols = useCallback(() => setSearching(true), []);
  const searchFiles = useCallback(() => surface.toggleSearch(), [surface]);
  const attachFile = useCallback(() => surface.addToChat(false), [surface]);
  const attachSelection = useCallback(() => surface.addToChat(true), [surface]);
  const closeSymbols = useCallback(() => setSearching(false), []);
  const searchSymbols = useCallback(
    async (query: string) => {
      await surface.run("workspaceSymbols", query);
      if (surface.getSnapshot().error)
        throw new Error(surface.getSnapshot().error ?? "Symbol search failed.");
      setSearching(false);
    },
    [surface],
  );
  const find = useCallback(() => surface.command("find"), [surface]);
  const goToLine = useCallback(() => surface.command("goToLine"), [surface]);
  const undo = useCallback(() => surface.command("undo"), [surface]);
  const redo = useCallback(() => surface.command("redo"), [surface]);
  const definition = useCallback(() => {
    void surface.run("definition");
  }, [surface]);
  const references = useCallback(() => {
    void surface.run("references");
  }, [surface]);
  const outline = useCallback(() => {
    void surface.run("symbols");
  }, [surface]);
  const diagnostics = useCallback(() => {
    void surface.run("diagnostics");
  }, [surface]);
  const rename = useCallback(() => surface.requestRename(), [surface]);
  const reviewRename = useCallback(() => surface.openRenameReview(), [surface]);
  const closeRename = useCallback(
    () => setDismissed(surface.getSnapshot().renameRequested),
    [surface],
  );
  const submitRename = useCallback(
    async (name: string) => {
      await surface.planRename(name);
      const current = surface.getSnapshot();
      if (current.error) throw new Error(current.error);
      closeRename();
    },
    [surface, closeRename],
  );
  const busy = !available || snapshot.busy;
  let tooltip = "Code intelligence";
  if (state === "disconnected") tooltip = "Connect the host to use code intelligence";
  else if (state === "update") tooltip = "Update the host to use code intelligence";
  return (
    <>
      {snapshot.leader !== null ? (
        <Text style={styles.pending} accessibilityLabel="Pending Vim leader">
          Space {snapshot.leader}
        </Text>
      ) : null}
      <DropdownMenu>
        <ToolbarButton
          kind="menu"
          label="Code intelligence"
          tooltip={snapshot.error ?? tooltip}
          testID="editor-code-menu"
        >
          <Icon size={14} uniProps={iconColor} />
        </ToolbarButton>
        <DropdownMenuContent side="bottom" align="end" width={280} sheetTitle="Code intelligence">
          {surface.workspaceOwned ? (
            <>
              <DropdownMenuItem onSelect={attachFile}>Add file to chat</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={attachSelection}
                disabled={!snapshot.selection.characters}
              >
                Add selection to chat
              </DropdownMenuItem>
            </>
          ) : null}
          <EditorShortcutMenuItem onSelect={find} label="Find and replace" helpId="editor-find" />
          <EditorShortcutMenuItem
            onSelect={goToLine}
            label="Go to line"
            helpId="editor-go-to-line"
          />
          <DropdownMenuItem onSelect={undo}>Undo</DropdownMenuItem>
          <DropdownMenuItem onSelect={redo}>Redo</DropdownMenuItem>
          <EditorExportItems surface={surface} />
          {!available ? <DropdownMenuHint>{tooltip}</DropdownMenuHint> : null}
          <EditorShortcutMenuItem
            onSelect={definition}
            disabled={busy}
            label="Go to definition"
            helpId="editor-go-to-definition"
          />
          <EditorShortcutMenuItem
            onSelect={references}
            disabled={busy}
            label="Find references"
            helpId="editor-find-references"
          />
          <EditorShortcutMenuItem
            onSelect={rename}
            disabled={busy}
            label="Rename symbol"
            helpId="editor-rename-symbol"
          />
          <EditorShortcutMenuItem
            onSelect={outline}
            disabled={busy}
            label="Outline"
            helpId="editor-outline"
          />
          <DropdownMenuItem onSelect={diagnostics} disabled={!available}>
            Diagnostics
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openSymbols} disabled={busy || !surface.workspaceOwned}>
            Search workspace symbols
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={searchFiles} disabled={!available || !surface.workspaceOwned}>
            Search and replace in files
          </DropdownMenuItem>
          {snapshot.plan || snapshot.outcome ? (
            <DropdownMenuItem onSelect={reviewRename}>Review last rename</DropdownMenuItem>
          ) : null}
          {snapshot.error ? <DropdownMenuHint>{snapshot.error}</DropdownMenuHint> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <AdaptiveRenameModal
        visible={canShowDialog && snapshot.renameRequested > dismissed}
        title="Rename symbol"
        initialValue=""
        submitLabel="Preview rename"
        onClose={closeRename}
        onSubmit={submitRename}
        testID="editor-rename-symbol"
      />
      <AdaptiveRenameModal
        visible={searching && canShowDialog}
        title="Search workspace symbols"
        initialValue=""
        submitLabel="Search"
        onClose={closeSymbols}
        onSubmit={searchSymbols}
        testID="editor-search-symbols"
      />
    </>
  );
}
const styles = StyleSheet.create((theme) => ({
  pending: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
}));
