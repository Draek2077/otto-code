import { useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { usePaneContext } from "@/panels/pane-context";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { VisualizerBackgroundControls } from "./background-controls";
import type { VisualizerBackgroundProps } from "./background-types";
import { useVisualizerBackgroundState } from "./background-state";
import { VisualizerGuest } from "./guest";
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
              follow={agentId === null}
              latestBubble={hidden}
              onState={ignoreState}
            />
          ) : null}
        </View>
      ) : null}
      <View
        style={enabled && hidden ? styles.hidden : foregroundStyle}
        pointerEvents={enabled && hidden ? "none" : "auto"}
        accessibilityElementsHidden={enabled && hidden}
        importantForAccessibility={enabled && hidden ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {enabled ? (
        <View style={styles.control}>
          <VisualizerBackgroundControls
            serverId={serverId}
            workspaceId={workspaceId}
            hidden={hidden}
            toggle={toggle}
          />
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
