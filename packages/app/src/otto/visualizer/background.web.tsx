import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { Eye, EyeOff } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { usePaneContext } from "@/panels/pane-context";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { VisualizerGuest } from "./guest";
import type { VisualizerBackgroundProps } from "./background-types";
import { useChatBackgroundPointer } from "./background-pointer.web";
import { useVisualizerBackgroundState } from "./background-state";
const EyeIcon = withUnistyles(Eye),
  HiddenIcon = withUnistyles(EyeOff);
const ignoreState = () => {};
export function VisualizerBackground({
  serverId,
  workspaceId,
  agentId,
  children,
  enabled = false,
}: VisualizerBackgroundProps) {
  const active = useRetainedPanelActive(),
    visible = useAppVisible(),
    { tabId } = usePaneContext();
  const key = `${serverId}:${workspaceId}:${tabId}`;
  const hidden = useVisualizerBackgroundState((state) => state.hidden[key] === true);
  const setHidden = useVisualizerBackgroundState((state) => state.setHidden);
  const root = useRef<HTMLDivElement | null>(null),
    foreground = useRef<HTMLDivElement | null>(null);
  const [peek, setPeek] = useState(false);
  const toggle = useCallback(() => setHidden(key, !hidden), [setHidden, key, hidden]);
  const restore = useCallback(() => setHidden(key, false), [setHidden, key]);
  useChatBackgroundPointer({
    rootRef: root,
    foregroundRef: foreground,
    enabled: enabled && active && visible,
    hidden,
    onPeek: setPeek,
    onToggle: toggle,
    onRestore: restore,
  });
  const style = useMemo<CSSProperties>(
    () => ({
      flex: 1,
      display: "flex",
      minHeight: 0,
      minWidth: 0,
      position: "relative",
      zIndex: 1,
      opacity: opacity(enabled, hidden, peek),
      pointerEvents: enabled && hidden ? "none" : "auto",
    }),
    [enabled, hidden, peek],
  );
  return (
    <div ref={root} style={rootStyle} data-testid="chat-visualizer-viewport">
      {enabled ? (
        <div style={backgroundStyle} data-testid="chat-visualizer-background">
          {active && visible ? (
            <VisualizerGuest
              key={`${serverId}:${workspaceId}:${tabId}`}
              serverId={serverId}
              workspaceId={workspaceId}
              placement="background"
              selectedId={agentId}
              follow={false}
              latestBubble={hidden}
              onState={ignoreState}
            />
          ) : null}
        </div>
      ) : null}
      <div ref={foreground} style={style}>
        {children}
      </div>
      {enabled ? (
        <div style={controlsStyle} data-chat-visualizer-controls>
          <ToolbarButton
            label={hidden ? "Show conversation" : "Show Visualizer only"}
            onPress={toggle}
          >
            {hidden ? <EyeIcon size={16} /> : <HiddenIcon size={16} />}
          </ToolbarButton>
        </div>
      ) : null}
    </div>
  );
}
function opacity(enabled: boolean, hidden: boolean, peek: boolean) {
  if (!enabled) return 1;
  if (hidden) return 0;
  return peek ? 0.25 : 0.8;
}
const rootStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: "flex",
  overflow: "hidden",
};
const backgroundStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  overflow: "hidden",
};
const controlsStyle: CSSProperties = { position: "absolute", right: 16, bottom: 8, zIndex: 2 };
