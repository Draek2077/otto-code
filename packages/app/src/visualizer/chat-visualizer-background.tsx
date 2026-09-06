import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Eye, EyeOff, OpenInFull, PictureInPicture, X } from "@/components/icons/material-icons";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { useFeatureEnabled } from "@/features/use-feature-enabled";
import { useAppSettings } from "@/hooks/use-settings";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { ChatVisualizerBackgroundContext } from "./chat-background-context";
import { useChatBackgroundPointer } from "./use-chat-background-pointer";
import { useFocusedTabIdFromLayout, useWorkspaceTabsFromLayout } from "./use-workspace-chat-focus";
import { useVisualizerSurface } from "./use-visualizer-surface";

const Surface = lazy(async () => ({
  default: (await import("./visualizer-surface")).VisualizerSurface,
}));
const ThemedEye = withUnistyles(Eye);
const ThemedEyeOff = withUnistyles(EyeOff);
const ThemedOpenInFull = withUnistyles(OpenInFull);
const ThemedPictureInPicture = withUnistyles(PictureInPicture);
const ThemedX = withUnistyles(X);
const CONTROLS_DATA = { chatVisualizerControls: "true" };
// A draft panel is replaced by an agent panel after its first send, and a
// focused chat can briefly lose eligibility while that replacement settles.
// Keep the user's explicit background choice with the workspace tab instead of
// treating it as a one-render opacity effect.
const hiddenConversationByTab = new Map<string, boolean>();

function hiddenConversationKey(serverId: string, workspaceId: string, tabId: string) {
  return `${serverId}\u0000${workspaceId}\u0000${tabId}`;
}

function resolveOpacity(enabled: boolean, hidden: boolean, peek: boolean) {
  if (!enabled) return { foreground: 1, background: 0.3 };
  if (hidden) return { foreground: 0, background: 1 };
  if (peek) return { foreground: 0.25, background: 0.8 };
  return { foreground: 1, background: 0.3 };
}

/** Fixed to the whole chat pane, outside both scroll strategies. Keeping
 * this wrapper and its foreground mounted also preserves detached readers. */
export function ChatVisualizerBackground({
  children,
}: {
  children: [conversation: ReactNode, composer: ReactNode];
}) {
  const { serverId, workspaceId, tabId, openFileInWorkspace } = usePaneContext();
  const { isVisible } = usePaneFocus();
  const isCompact = useIsCompactFormFactor();
  const featureEnabled = useFeatureEnabled("visualizer");
  const { settings } = useAppSettings();
  const workspaceKey = useMemo(
    () => buildWorkspaceTabPersistenceKey({ serverId, workspaceId }),
    [serverId, workspaceId],
  );
  const tabs = useWorkspaceTabsFromLayout(workspaceKey);
  const focusedTabId = useFocusedTabIdFromLayout(workspaceKey);
  const hiddenKey = useMemo(
    () => hiddenConversationKey(serverId, workspaceId, tabId),
    [serverId, workspaceId, tabId],
  );
  // One background guest in the focused chat, even with several visible splits.
  const enabled =
    featureEnabled &&
    settings.visualizerBackgroundOpen &&
    !settings.visualizerPipOpen &&
    isVisible &&
    focusedTabId === tabId &&
    !tabs.some((tab) => tab.target.kind === "visualizer");
  const { collapseToPip, expandToTab, closeBackground } = useVisualizerSurface(
    serverId,
    workspaceId,
  );
  const backgroundPlacementActive =
    featureEnabled &&
    settings.visualizerBackgroundOpen &&
    !settings.visualizerPipOpen &&
    !tabs.some((tab) => tab.target.kind === "visualizer");
  const [hidden, setHidden] = useState(() => hiddenConversationByTab.get(hiddenKey) ?? false);
  const [peek, setPeek] = useState(false);
  const [stageColor, setStageColor] = useState<string | null>(null);
  const backgroundColor = enabled ? stageColor : null;
  const stageStyle = useMemo(
    () => (backgroundColor ? { backgroundColor } : undefined),
    [backgroundColor],
  );
  const rootRef = useRef<View>(null);
  const foregroundRef = useRef<View>(null);
  const animations = useAnimationsEnabled();
  const setConversationHidden = useCallback(
    (next: boolean) => {
      setHidden(next);
      if (next) {
        hiddenConversationByTab.set(hiddenKey, true);
      } else {
        hiddenConversationByTab.delete(hiddenKey);
      }
    },
    [hiddenKey],
  );
  const toggle = useCallback(() => {
    setHidden((value) => {
      const next = !value;
      if (next) {
        hiddenConversationByTab.set(hiddenKey, true);
      } else {
        hiddenConversationByTab.delete(hiddenKey);
      }
      return next;
    });
    setPeek(false);
  }, [hiddenKey]);
  const restore = useCallback(() => {
    setConversationHidden(false);
    setPeek(false);
  }, [setConversationHidden]);
  useEffect(() => {
    setHidden(hiddenConversationByTab.get(hiddenKey) ?? false);
    setPeek(false);
  }, [hiddenKey]);
  useEffect(() => {
    if (!backgroundPlacementActive) restore();
  }, [backgroundPlacementActive, restore]);
  useChatBackgroundPointer({
    rootRef,
    foregroundRef,
    enabled,
    hidden,
    onPeek: setPeek,
    onToggle: toggle,
    onRestore: restore,
  });
  const opacity = resolveOpacity(enabled, hidden, peek);
  const transition = useMemo(
    () =>
      isWeb
        ? { transitionProperty: "opacity", transitionDuration: animations ? "180ms" : "0ms" }
        : {},
    [animations],
  );
  const foregroundStyle = useMemo(
    () => ({ opacity: opacity.foreground, ...transition }),
    [opacity.foreground, transition],
  );
  const backgroundStyle = useMemo(
    () => ({ opacity: opacity.background, ...transition }),
    [opacity.background, transition],
  );
  return (
    <ChatVisualizerBackgroundContext.Provider value={enabled}>
      <View ref={rootRef} style={[styles.root, stageStyle]} testID="chat-visualizer-viewport">
        {enabled ? (
          <View
            style={[styles.background, backgroundStyle]}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID="chat-visualizer-background"
          >
            <Suspense fallback={null}>
              <Surface
                serverId={serverId}
                workspaceId={workspaceId}
                surface="background"
                chatTabId={tabId}
                showLatestAssistantBubble={hidden}
                onBackgroundColorChange={setStageColor}
                isVisible={isVisible}
                followActive
                onOpenFile={openFileInWorkspace}
              />
            </Suspense>
          </View>
        ) : null}
        <View
          ref={foregroundRef}
          style={[styles.foreground, foregroundStyle]}
          pointerEvents={enabled && hidden ? "none" : "auto"}
          accessibilityElementsHidden={enabled && hidden}
          importantForAccessibility={enabled && hidden ? "no-hide-descendants" : "auto"}
          testID="chat-visualizer-conversation"
        >
          {children[0]}
        </View>
        <View testID="chat-visualizer-composer">{children[1]}</View>
        {enabled ? (
          <View style={styles.controls} dataSet={CONTROLS_DATA}>
            <ToolbarIconButton
              label={hidden ? "Show conversation" : "Hide conversation"}
              Icon={hidden ? ThemedEye : ThemedEyeOff}
              onPress={toggle}
              testID="chat-visualizer-toggle"
            />
            {!isCompact ? (
              <ToolbarIconButton
                label="Collapse to picture-in-picture"
                Icon={ThemedPictureInPicture}
                onPress={collapseToPip}
                testID="chat-visualizer-pip"
              />
            ) : null}
            <ToolbarIconButton
              label="Open visualizer in a tab"
              Icon={ThemedOpenInFull}
              onPress={expandToTab}
              testID="chat-visualizer-expand"
            />
            <ToolbarIconButton
              label="Close visualizer background"
              Icon={ThemedX}
              onPress={closeBackground}
              testID="chat-visualizer-close"
            />
          </View>
        ) : null}
      </View>
    </ChatVisualizerBackgroundContext.Provider>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0, position: "relative", overflow: "hidden" },
  background: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
  foreground: { flex: 1, minHeight: 0 },
  controls: {
    position: "absolute",
    top: theme.spacing[2],
    right: theme.spacing[2],
    flexDirection: "row",
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
}));
