import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { TerminalPane } from "@/components/terminal-pane";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { usePublishPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { useAppSettings } from "@/hooks/use-settings";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
import { useTerminalDirectory } from "@/otto/terminal/directory";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useEditorConnection } from "./client";
import { FileTerminalController } from "./terminal-controller";
import type { EditorPreferences } from "./preferences";
import { useEditorFileMode } from "./view-controls";
import { editorPreviewKind } from "./viewers/kind";

interface Input {
  serverId: string;
  root: string;
  file: string;
  line: number | null;
  preview: boolean;
  children: ReactNode;
  refresh: () => void;
}
function confirmStop() {
  return confirmDialog({
    title: "Stop the file editor?",
    message: "Save in the terminal editor first. Stopping it discards any unsaved terminal buffer.",
    confirmLabel: "Stop editor",
    destructive: true,
  });
}
function ExternalEditor({ input, preferences }: { input: Input; preferences: EditorPreferences }) {
  const pane = usePaneContext();
  const focus = usePaneFocus();
  const connection = useEditorConnection(input.serverId);
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  const [builtin, setBuiltin] = useState(false);
  const [model] = useState(
    () =>
      new FileTerminalController(
        {
          hostId: input.serverId,
          workspaceId: pane.workspaceId,
          file:
            resolveWorkspaceFilePaths({ path: input.file, workspaceRoot: input.root })
              ?.absolutePath ?? input.file,
        },
        preferences,
        input.line,
      ),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const open = useCallback(() => void model.open(true), [model]);
  useEffect(() => {
    model.connect(connection.client);
    if (!builtin && !input.preview && retained && visible) void model.open();
    return () => model.connect(null);
  }, [model, connection.client, builtin, input.preview, retained, visible]);
  const close = useCallback(() => model.stop(confirmStop), [model]);
  usePublishPanelInstanceAttributes({
    modified: !builtin && Boolean(state.session || state.pending || model.hasUncertainLaunch),
    beforeClose: builtin ? undefined : close,
  });
  const useBuiltin = useCallback(async () => {
    if (!(await model.stop(confirmStop))) return;
    input.refresh();
    setBuiltin(true);
  }, [model, input]);
  const openDirectory = useTerminalDirectory({
    serverId: input.serverId,
    workspaceId: pane.workspaceId,
    root: input.root,
    isGit: false,
  });
  const openExplorer = useCallback(() => openDirectory(input.root), [openDirectory, input.root]);
  const exited = useCallback(() => {
    model.exited();
    input.refresh();
  }, [model, input]);
  if (builtin || (input.preview && !state.session && !state.pending)) return input.children;
  return (
    <View style={styles.container} testID="otto-terminal-file-editor">
      <PaneContentToolbar>
        <Button size="sm" variant="outline" onPress={useBuiltin}>
          Use Otto editor
        </Button>
        {state.error && (
          <Button size="sm" variant="outline" onPress={open}>
            Retry
          </Button>
        )}
      </PaneContentToolbar>
      {connection.state !== "ready" && (
        <Alert variant="warning">
          {connection.state === "update"
            ? "Update the host to use terminal file editing."
            : "Reconnect to the host to use this editor."}
        </Alert>
      )}
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.exited && <Alert>The editor exited. Open the saved file in Otto to continue.</Alert>}
      {state.session && (
        <TerminalPane
          serverId={input.serverId}
          cwd={state.session.cwd}
          terminalId={state.session.terminalId}
          isWorkspaceFocused={focus.isWorkspaceFocused}
          isPaneFocused={focus.isPaneFocused}
          onOpenDirectory={openDirectory}
          onOpenFileExplorer={openExplorer}
          onOpenWorkspaceFile={pane.openFileInWorkspace}
          onExit={exited}
        />
      )}
    </View>
  );
}
/** A mode is captured per opened file. Preference changes never unmount a dirty
 * CodeMirror draft or retarget a terminal buffer; reopening adopts the new mode. */
export function TerminalEditorGate(input: Input) {
  const { settings, isLoading } = useAppSettings();
  if (isLoading) return null;
  return <OpenedEditor input={input} preferences={settings} />;
}
function OpenedEditor({ input, preferences }: { input: Input; preferences: EditorPreferences }) {
  const [captured] = useState(() => preferences);
  const fileView = useEditorFileMode(
    input.file,
    Boolean(editorPreviewKind(input.file)),
    input.line !== null,
  );
  const resolvedInput = useMemo(
    () => ({ ...input, preview: fileView.mode === "preview" }),
    [input, fileView.mode],
  );
  const markdown = /\.(md|mdx|markdown)$/iu.test(input.file);
  if (captured.fileEditorMode === "off" || (markdown && captured.alwaysUseOttoEditorForMarkdown))
    return input.children;
  return <ExternalEditor input={resolvedInput} preferences={captured} />;
}
const styles = StyleSheet.create({ container: { flex: 1, minHeight: 0 } });
