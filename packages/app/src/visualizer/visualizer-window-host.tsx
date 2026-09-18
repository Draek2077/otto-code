import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { VisualizerPipHost, type VisualizerPipHostProps } from "./visualizer-pip-host";
import {
  closeVisualizerTabs,
  getVisualizerTabs,
  VisualizerActiveWorkspaceContext,
} from "./visualizer-tab-owner";

type WorkspaceSource = Omit<VisualizerPipHostProps, "isVisible">;
type RegisterSource = (source: WorkspaceSource) => () => void;
const WorkspaceSourceContext = createContext<RegisterSource | null>(null);

/** The only PIP mount in an app window. Retained workspace trees register the
 * active source, never their own guest. Changing workspace tears down the old
 * guest before initializing its replacement from the new workspace's history. */
export function VisualizerWindowProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<WorkspaceSource | null>(null);
  const register = useCallback<RegisterSource>((next) => {
    setSource(next);
    return () => setSource((current) => (current === next ? null : current));
  }, []);
  // Only tab ownership changes matter, not every pane resize or tab-state write.
  const tabInventory = useWorkspaceLayoutStore((state) =>
    JSON.stringify(
      getVisualizerTabs(state.layoutByWorkspace).map(({ workspaceKey, tab }) => [
        workspaceKey,
        tab.tabId,
      ]),
    ),
  );
  const workspaceKey = source ? buildWorkspaceTabPersistenceKey(source) : null;
  useEffect(() => {
    // Workspace registration settles in layout effects. Do not choose a stale
    // restored tab before the active workspace has registered its source.
    if (!workspaceKey) return;
    const tabs = getVisualizerTabs(useWorkspaceLayoutStore.getState().layoutByWorkspace).filter(
      (entry) => entry.workspaceKey === workspaceKey,
    );
    if (tabs.length < 2) return;
    // Reconcile old per-orchestration duplicates within this workspace only.
    // Tabs in inactive workspaces are saved destinations, not live visualizers.
    closeVisualizerTabs(workspaceKey, tabs[0]!.tab.tabId);
  }, [tabInventory, workspaceKey]);

  return (
    <WorkspaceSourceContext value={register}>
      <VisualizerActiveWorkspaceContext value={workspaceKey}>
        {children}
        {source ? <VisualizerPipHost key={workspaceKey} {...source} isVisible /> : null}
      </VisualizerActiveWorkspaceContext>
    </WorkspaceSourceContext>
  );
}

export function useVisualizerWorkspaceSource({
  serverId,
  workspaceId,
  isVisible,
  onOpenFile,
}: VisualizerPipHostProps): void {
  const register = useContext(WorkspaceSourceContext);
  useLayoutEffect(() => {
    if (!isVisible || !workspaceId || !register) return;
    return register({ serverId, workspaceId, onOpenFile });
  }, [register, serverId, workspaceId, isVisible, onOpenFile]);
}
