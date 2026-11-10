import { useCallback } from "react";
import { View } from "react-native";
import { Eye, EyeOff } from "lucide-react-native";
import { withUnistyles, StyleSheet } from "react-native-unistyles";
import { usePaneContext } from "@/panels/pane-context";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import type { VisualizerBackgroundProps } from "./background-types";
import { useVisualizerBackgroundState } from "./background-state";
import { VisualizerGuest } from "./guest";
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
  const hidden = useVisualizerBackgroundState((state) => state.hidden[key] === true),
    setHidden = useVisualizerBackgroundState((state) => state.setHidden);
  const toggle = useCallback(() => setHidden(key, !hidden), [hidden, setHidden, key]);
  const foregroundStyle = enabled ? styles.foreground : styles.root;
  return (
    <View style={styles.root}>
      {enabled ? (
        <View style={styles.background}>
          {active && visible ? (
            <VisualizerGuest
              serverId={serverId}
              workspaceId={workspaceId}
              placement="background"
              selectedId={agentId}
              follow={false}
              latestBubble={hidden}
              onState={ignoreState}
            />
          ) : null}
        </View>
      ) : null}
      <View
        style={enabled && hidden ? styles.hidden : foregroundStyle}
        pointerEvents={enabled && hidden ? "none" : "auto"}
      >
        {children}
      </View>
      {enabled ? (
        <View style={styles.control}>
          <ToolbarButton
            label={hidden ? "Show conversation" : "Show Visualizer only"}
            onPress={toggle}
          >
            {hidden ? <EyeIcon size={16} /> : <HiddenIcon size={16} />}
          </ToolbarButton>
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, overflow: "hidden" },
  background: { position: "absolute", inset: 0 },
  foreground: { flex: 1, opacity: 0.8 },
  hidden: { flex: 1, opacity: 0 },
  control: { position: "absolute", right: 16, bottom: 8, zIndex: 2 },
});
