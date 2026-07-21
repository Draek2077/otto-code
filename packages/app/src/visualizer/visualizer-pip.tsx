// Picture-in-picture Visualizer — a small live viewport floating over the
// workspace content, so the graph stays glanceable while you work in the chat
// underneath. Desktop/web only (see visualizer-pip-host.tsx for the gate).
//
// ── Why ONE canvas, not two ────────────────────────────────────────────────
// The charter asks whether PIP reparents the existing canvas or hosts a second
// one. Neither, quite:
//
// Reparenting is not available. The guest is an Electron `<webview>` (a
// cross-process surface), and moving that element in the DOM detaches and
// reattaches it, which makes Electron RELOAD the guest — see the
// `did-start-loading` re-hide in visualizer-view.electron.tsx, which exists
// precisely because a layout change already does this today. A reparent would
// therefore destroy the simulation it was supposed to preserve. On web the
// iframe has the same problem for the same reason (a moved iframe re-executes).
//
// Two live canvases is the cost the charter warns about: two simulations, two
// star fields, two bloom pipelines, doubled per-frame work forever.
//
// So PIP and the tab are MUTUALLY EXCLUSIVE. Opening PIP closes the tab;
// expanding PIP closes PIP and opens the tab. There is exactly one guest alive
// at any moment — one sim, one star field — and no reparent is needed because
// we never move a guest, we retire one and start the other. The scene survives
// the handover for free: the adapter's reset+replay rehydrates from the session
// buffers and the vendor page SETTLES that history to its end state instead of
// animating it (docs/visualizer.md "Hydrate on attach"), which is the same path
// that already restores a tab woken from resource sleep.
//
// ── Layering, and why it is shaped like this ───────────────────────────────
//   anchor (absolute fill, box-none)   ← measures the container for clamping
//     frame (absolute, left/top from the drag fraction)
//       fadeLayer (opacity)            ← background + border + THE GUEST
//       dragLayer (transparent)        ← above the guest: see use-visualizer-pip-drag
//       controls                       ← SIBLING of fadeLayer, so it never fades
//
// The fade has to wrap the frame's own background and border, not just the
// guest: fading the guest alone composites it over the frame's opaque surface
// color, which looks like a washed-out grey rectangle instead of transparency.
// Everything you should be able to see through goes inside `fadeLayer`;
// everything you still need to click stays outside it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  CloseFullscreen,
  Maximize,
  OpenInFull,
  Pin,
  PinOff,
  X,
} from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VISUALIZER_PIP_FADE_DURATION_MS } from "@/constants/animation";
import { CHAT_PANE_OVERLAY_Z } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import { useAppSettings } from "@/hooks/use-settings";
import { useVisualizerPipDrag, type PipFraction } from "@/visualizer/use-visualizer-pip-drag";
import { useVisualizerSurface } from "@/visualizer/use-visualizer-surface";
import { PIP_DIMENSIONS, PIP_HOVER_OPACITY } from "@/visualizer/visualizer-chrome-profile";
import { VisualizerSurface } from "@/visualizer/visualizer-surface";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";

export interface VisualizerPipProps {
  serverId: string;
  workspaceId: string;
  /** The workspace is on screen. False parks the guest (zero frames). */
  isVisible: boolean;
  /** The PIP should be showing. False while the host is holding it mounted for
   * its fade-out (see visualizer-pip-host.tsx). */
  shown: boolean;
  onOpenFile: (request: WorkspaceFileOpenRequest) => void;
}

/** The real PIP body. Loaded lazily by visualizer-pip-host.tsx — this module
 * transitively pulls the vendored render layer, so it must never sit in the
 * startup graph (docs/feature-flags.md: Metro does not tree-shake). */
export function VisualizerPip({
  serverId,
  workspaceId,
  isVisible,
  shown,
  onOpenFile,
}: VisualizerPipProps) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const animationsEnabled = useAnimationsEnabled();
  const [hovered, setHovered] = useState(false);
  // Follow-the-active-chat, owned here because PIP has no toolbar to hold it.
  // Lifted into VisualizerSurface so PIP and the tab share ONE follow state
  // rather than two that disagree. Pinned = frozen on the chat it was showing.
  const [followActive, setFollowActive] = useState(true);
  // Measured from the anchor, which fills the workspace content area. Seeded at
  // 0, which resolves EVERY stored fraction to the top-left corner — so the frame
  // stays unmounted until this is real (`measured` below). Rendering it against
  // the seed is what used to make the PIP appear in the corner and then jump to
  // its saved position on the next frame.
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const measured = container.width > 0 && container.height > 0;

  const size = settings.visualizerPipSize;
  const dimensions = PIP_DIMENSIONS[size];

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainer((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    );
  }, []);

  const fraction = useMemo<PipFraction>(
    () => ({ x: settings.visualizerPipX, y: settings.visualizerPipY }),
    [settings.visualizerPipX, settings.visualizerPipY],
  );
  const handleCommitPosition = useCallback(
    (next: PipFraction) => {
      void updateSettings({ visualizerPipX: next.x, visualizerPipY: next.y });
    },
    [updateSettings],
  );
  const drag = useVisualizerPipDrag({
    container,
    pip: dimensions,
    fraction,
    onCommit: handleCommitPosition,
  });

  const handleToggleSize = useCallback(() => {
    void updateSettings({ visualizerPipSize: size === "small" ? "medium" : "small" });
  }, [size, updateSettings]);

  const handleTogglePin = useCallback(() => {
    setFollowActive((previous) => !previous);
  }, []);

  // Both surface transitions live in use-visualizer-surface.ts, which also
  // records which surface to bring back next time. Close leaves that memory
  // alone (reopening from the header gives you the PIP again); expand rewrites
  // it to "tab", because that is now the surface you are using.
  const { closePip: handleClose, expandToTab: handleExpand } = useVisualizerSurface(
    serverId,
    workspaceId,
  );

  // Presence fade: 0 until the position is known, then up; back down when the
  // host hands us `shown: false` (closed, or handed over to a full tab) while it
  // holds the mount open for exactly this long. With Animations off both edges
  // snap, which is the old instant behavior.
  const presence = useSharedValue(0);
  useEffect(() => {
    const target = shown && measured ? 1 : 0;
    presence.value = animationsEnabled
      ? withTiming(target, { duration: VISUALIZER_PIP_FADE_DURATION_MS })
      : target;
  }, [shown, measured, animationsEnabled, presence]);
  const presenceStyle = useAnimatedStyle(() => ({ opacity: presence.value }));

  // FRAME_STYLE is a plain object, not a Unistyles theme style: this is a
  // Reanimated view, and a `StyleSheet.create((theme) => …)` style on one crashes
  // on theme change (docs/unistyles.md).
  const frameStyle = useMemo(
    () => [
      FRAME_STYLE,
      {
        width: dimensions.width,
        height: dimensions.height,
        left: drag.offset.left,
        top: drag.offset.top,
      },
      presenceStyle,
    ],
    [dimensions.width, dimensions.height, drag.offset.left, drag.offset.top, presenceStyle],
  );
  // Don't fade mid-drag: the user is aiming this thing and needs to see it.
  const faded = hovered && !drag.dragging;
  const fadeStyle = useMemo(
    () => [styles.fadeLayer, { opacity: faded ? PIP_HOVER_OPACITY : 1 }],
    [faded],
  );
  // Web-only style cast, same escape hatch ResizeHandle uses: RN's `cursor`
  // type only admits auto/pointer, and `touchAction: "none"` has no RN
  // equivalent at all. touchAction is NOT optional — without it the browser
  // claims the gesture as a scroll/pan and the pointermove stream dies.
  const dragStyle = useMemo(
    () => [
      styles.dragLayer,
      isWeb &&
        ({
          cursor: drag.dragging ? "grabbing" : "grab",
          touchAction: "none",
        } as object),
    ],
    [drag.dragging],
  );

  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);

  return (
    <View style={styles.anchor} pointerEvents="box-none" onLayout={handleLayout}>
      {/* Nothing at all until the anchor has been measured — see `measured`. */}
      {!measured ? null : (
        /* Plain (non-Pressable) view owns hover; the Pressables inside are
           separate — the canonical pattern in docs/hover.md. */
        <Animated.View
          style={frameStyle}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        >
          <View style={fadeStyle} pointerEvents="none">
            <VisualizerSurface
              serverId={serverId}
              workspaceId={workspaceId}
              surface="pip"
              isVisible={isVisible}
              onOpenFile={onOpenFile}
              followActive={followActive}
              onFollowActiveChange={setFollowActive}
            />
          </View>
          {/* Transparent, and stacked above the guest — the only place a
            pointerdown over the graph can be observed at all. */}
          <View style={dragStyle} {...drag.handlers} />
          {/* Sibling of the fade layer, so it stays fully opaque and clickable
            while everything beneath it goes see-through. */}
          {hovered ? (
            <View style={styles.controls}>
              <PipButton
                label={
                  followActive
                    ? t("workspace.visualizer.pip.pin")
                    : t("workspace.visualizer.pip.unpin")
                }
                onPress={handleTogglePin}
                icon={followActive ? "pin" : "pinned"}
              />
              <PipButton
                label={
                  size === "small"
                    ? t("workspace.visualizer.pip.sizeMedium")
                    : t("workspace.visualizer.pip.sizeSmall")
                }
                onPress={handleToggleSize}
                icon={size === "small" ? "grow" : "shrink"}
              />
              <PipButton
                label={t("workspace.visualizer.pip.expand")}
                onPress={handleExpand}
                icon="expand"
              />
              <PipButton
                label={t("workspace.visualizer.pip.close")}
                onPress={handleClose}
                icon="close"
              />
            </View>
          ) : null}
        </Animated.View>
      )}
    </View>
  );
}

function PipButton({
  label,
  onPress,
  icon,
}: {
  label: string;
  onPress: () => void;
  icon: "grow" | "shrink" | "expand" | "close" | "pin" | "pinned";
}) {
  const Icon = PIP_ICONS[icon];
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={controlButtonStyle}
      >
        <Icon size={14} color={pipIconColor} />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={6}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function controlButtonStyle({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) {
  return [styles.controlButton, (Boolean(hovered) || Boolean(pressed)) && styles.controlButtonOn];
}

const PIP_ICONS = {
  grow: OpenInFull,
  shrink: CloseFullscreen,
  expand: Maximize,
  close: X,
  // Following the active chat = not pinned yet, so the control offers the pin;
  // once pinned it offers the release.
  pin: Pin,
  pinned: PinOff,
} as const;

// Static because the strip sits on its own dark scrim in every theme.
const pipIconColor = "rgba(255,255,255,0.92)";

// The frame itself carries no theming, so it lives outside the Unistyles sheet —
// it is applied to a Reanimated view, and theme styles crash those on theme
// change (docs/unistyles.md).
const FRAME_STYLE = { position: "absolute" } as const;

// The frame's outline. Shared, because the control strip insets itself by
// exactly this much to avoid painting over it — the two must not drift apart.
const PIP_BORDER_WIDTH = 1;

const styles = StyleSheet.create((theme) => ({
  // Fills the workspace content area so onLayout measures the region the PIP is
  // allowed to move within. box-none: only the frame takes pointer events, so
  // the chat behind stays fully interactive everywhere else.
  anchor: {
    position: "absolute",
    top: theme.spacing[2],
    left: theme.spacing[2],
    right: theme.spacing[2],
    bottom: theme.spacing[2],
    // Slot in the shared chat-overlay stack (constants/layout.ts). Note this
    // only orders the PIP against siblings in ITS container — the suggested-task
    // card lives inside a pane, i.e. below this whole subtree, so it can never
    // out-paint the PIP by z-index. That collision is solved by geometry: the
    // card insets itself by useVisualizerPipInset() so the two never overlap.
    zIndex: CHAT_PANE_OVERLAY_Z.visualizerPip,
  },
  // Everything you should be able to see THROUGH on hover lives in here — the
  // background and border included, or the fade reads as pale grey rather than
  // transparent (see PIP_HOVER_OPACITY).
  fadeLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
    borderWidth: PIP_BORDER_WIDTH,
    borderColor: theme.colors.border,
  },
  dragLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  controls: {
    position: "absolute",
    // Inset by the frame's border width so the strip sits INSIDE the border
    // rather than painting over it — the PIP keeps one unbroken outline all the
    // way around, instead of the outline dying wherever the controls overlap it.
    // Must track `fadeLayer.borderWidth`.
    top: PIP_BORDER_WIDTH,
    right: PIP_BORDER_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    // One extra pixel on the two outer edges, so the glyphs don't read as
    // crowded into the corner.
    padding: 2,
    paddingTop: 3,
    paddingRight: 3,
    // The INNER radius of the frame's corner: the outer curve minus the border
    // it now sits inside. Using the outer radius here would leave a sliver of
    // background poking past the border's inside edge.
    borderTopRightRadius: theme.borderRadius.md - PIP_BORDER_WIDTH,
    borderBottomLeftRadius: theme.borderRadius.sm,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  controlButton: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
  },
  controlButtonOn: {
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
