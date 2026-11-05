import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { Search } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { Alert } from "@/components/ui/alert";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useEditorConnection } from "./client";
import { EditorWorkspaceEdits } from "./workspace-edits";
import { EditorSearchPane } from "./search-pane";
import { EditorRenameReview } from "./rename-review";
const Icon = withUnistyles(Search);
const color = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
function WorkspaceSearch({ model }: { model: EditorWorkspaceEdits }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  return (
    <View style={styles.frame}>
      {state.error ? <Alert variant="error">{state.error}</Alert> : null}
      <EditorSearchPane surface={model} />
      {state.panel === "rename" ? <EditorRenameReview surface={model} /> : null}
    </View>
  );
}
export function useEditorExplorerSearch(input: {
  serverId: string;
  workspaceRoot: string;
  workspaceId?: string | null;
  onOpenFile?: (path: string) => void;
}) {
  const connection = useEditorConnection(input.serverId);
  const retained = useRetainedPanelActive(),
    visible = useAppVisible();
  const [open, setOpen] = useState(false);
  const latest = useRef(input);
  latest.current = input;
  const model = useMemo(
    () =>
      new EditorWorkspaceEdits({
        hostId: input.serverId,
        root: input.workspaceRoot,
        workspaceId: input.workspaceId,
        close: () => setOpen(false),
        navigate: (location) => latest.current.onOpenFile?.(location.file),
      }),
    [input.serverId, input.workspaceRoot, input.workspaceId],
  );
  useEffect(() => {
    model.connect(open && retained && visible ? connection.client : null);
    return () => model.connect(null);
  }, [model, open, retained, visible, connection.client]);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const control = useMemo(
    () => (
      <ToolbarButton
        label="Search file contents"
        selected={open}
        disabled={!connection.client}
        onPress={toggle}
        testID="files-search-contents"
      >
        <Icon size={14} uniProps={color} />
      </ToolbarButton>
    ),
    [open, connection.client, toggle],
  );
  const content = useMemo(() => (open ? <WorkspaceSearch model={model} /> : null), [open, model]);
  return { control, content };
}
const styles = StyleSheet.create({ frame: { flex: 1, minHeight: 0 } });
