import { Fragment, useCallback, useMemo, useState, type ReactElement } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  BarChart,
  DollarSign,
  Eye,
  EyeOff,
  Files,
  FitScreen,
  PictureInPicture,
  Pin,
  PinFilled,
  Restart,
  Timeline,
  Volume2,
  VolumeX,
} from "@/components/icons/material-icons";
import { PANE_TOOLBAR_HEIGHT } from "@/components/ui/control-geometry";
import { useIsCompactFormFactor } from "@/constants/layout";
import { TAB_MAX_WIDTH } from "@/screens/workspace/workspace-tab-layout";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { ToolbarSeparator } from "@/components/ui/toolbar-separator";

// The visualizer tab's top toolbar — the native Otto counterpart to the
// controls that used to live inside the vendored webview HUD. Chats switcher +
// audio toggle on the left; panel/HUD toggles on the right. Always visible; the HUD-eye
// here hides only the in-webview HUD (see visualizer-panel.tsx / OTTO-PATCHES.md).

const ThemedFiles = withUnistyles(Files);
const ThemedTimeline = withUnistyles(Timeline);
const ThemedDollarSign = withUnistyles(DollarSign);
const ThemedVolume2 = withUnistyles(Volume2);
const ThemedVolumeX = withUnistyles(VolumeX);
const ThemedEye = withUnistyles(Eye);
const ThemedEyeOff = withUnistyles(EyeOff);
const ThemedFitScreen = withUnistyles(FitScreen);
const ThemedBarChart = withUnistyles(BarChart);
const ThemedRestart = withUnistyles(Restart);
const ThemedPin = withUnistyles(Pin);
const ThemedPinFilled = withUnistyles(PinFilled);
const ThemedPictureInPicture = withUnistyles(PictureInPicture);

// Responsive collapse: as the toolbar narrows, five lower-priority controls drop
// one at a time — roughly nearest-the-center-gap first, with Stats kept until
// last: Timeline → Files → Cost → Pin → Stats. Everything else (chat picker,
// audio, zoom, restart, HUD) always stays. Hiding is a pure function of the
// measured bar width — no measure/hide feedback loop — so it can't oscillate.
const COLLAPSE_ORDER = ["timeline", "files", "cost", "pin", "stats"] as const;
type CollapsibleControl = (typeof COLLAPSE_ORDER)[number];

// Width budget (px). Estimates, not pixel-exact: the goal is to drop a control a
// touch before it would clip, never to clip. Tune here if the thresholds feel
// off. Icon slots differ by form factor because mobile doubles toolbar glyphs.
const COMPACT_ICON_SLOT = 45; // 32px glyph + 8px padding + 5px gap
const REGULAR_ICON_SLOT = 29; // 16px glyph + 8px padding + 5px gap
const SEPARATOR_SLOT = 14;
const CHAT_MIN_WIDTH = 96;
const BAR_HORIZONTAL_PADDING = 16; // 2 × spacing[2]
const ALWAYS_VISIBLE_ICON_COUNT = 4; // audio, zoom, restart, HUD
const ALWAYS_VISIBLE_SEPARATOR_COUNT = 3; // 2 in the left group + 1 before HUD

/** Which collapsible controls to hide at the given bar width. Null width (first
 * paint, before layout) shows everything. The PIP control is never collapsed —
 * it is a surface switch, not an informational toggle, and a mode control that
 * vanishes as you narrow the pane is how you lose the surface you're in — so it
 * only widens the reserved budget. */
function computeHiddenControls(
  barWidth: number | null,
  isCompact: boolean,
  hasPipControl: boolean,
): ReadonlySet<CollapsibleControl> {
  if (barWidth === null) {
    return EMPTY_HIDDEN;
  }
  const iconSlot = isCompact ? COMPACT_ICON_SLOT : REGULAR_ICON_SLOT;
  const reserved =
    BAR_HORIZONTAL_PADDING +
    CHAT_MIN_WIDTH +
    (ALWAYS_VISIBLE_ICON_COUNT + (hasPipControl ? 1 : 0)) * iconSlot +
    ALWAYS_VISIBLE_SEPARATOR_COUNT * SEPARATOR_SLOT;
  const room = barWidth - reserved;
  const fit = Math.max(0, Math.min(COLLAPSE_ORDER.length, Math.floor(room / iconSlot)));
  return new Set(COLLAPSE_ORDER.slice(0, COLLAPSE_ORDER.length - fit));
}

const EMPTY_HIDDEN: ReadonlySet<CollapsibleControl> = new Set();

export interface VisualizerToolbarProps {
  sessions: { id: string; label: string; status: "active" | "completed" }[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  followActive: boolean;
  onToggleFollow: () => void;
  timelineOpen: boolean;
  filesOpen: boolean;
  costOpen: boolean;
  statsOpen: boolean;
  soundMuted: boolean;
  hudHidden: boolean;
  onToggleTimeline: () => void;
  onToggleFiles: () => void;
  onToggleCost: () => void;
  onToggleStats: () => void;
  onZoomToFit: () => void;
  onRestart: () => void;
  onToggleAudio: () => void;
  onToggleHud: () => void;
  /** Collapse the tab into the picture-in-picture viewport. Null where the PIP
   * doesn't exist (compact layouts) — see visualizer-pip-host.tsx. */
  onCollapseToPip: (() => void) | null;
}

export function VisualizerToolbar({
  sessions,
  selectedSessionId,
  onSelectSession,
  followActive,
  onToggleFollow,
  timelineOpen,
  filesOpen,
  costOpen,
  statsOpen,
  soundMuted,
  hudHidden,
  onToggleTimeline,
  onToggleFiles,
  onToggleCost,
  onToggleStats,
  onZoomToFit,
  onRestart,
  onToggleAudio,
  onToggleHud,
  onCollapseToPip,
}: VisualizerToolbarProps) {
  // Zoom to Fit and Restart act on the live simulation — disable them when no
  // chat is selected (the "Waiting for chat activity" empty state) since there's
  // nothing to fit or restart.
  const viewportDisabled = selectedSessionId === null;
  // Hiding the HUD force-hides every informational panel (Timeline / Files /
  // Cost / Stats) — visualizer-panel forces config.panels off while hidden — so
  // their toggles are disabled and shown unselected until the HUD is re-enabled.
  const panelsDisabled = hudHidden;
  // Responsive collapse (see COLLAPSE_ORDER): measure the bar, derive which
  // controls to drop. Mobile's doubled glyphs make room run out sooner.
  const isCompact = useIsCompactFormFactor();
  const [barWidth, setBarWidth] = useState<number | null>(null);
  const handleBarLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setBarWidth((prev) => (prev !== null && Math.abs(prev - width) < 1 ? prev : width));
  }, []);
  const hidden = useMemo(
    () => computeHiddenControls(barWidth, isCompact, onCollapseToPip !== null),
    [barWidth, isCompact, onCollapseToPip],
  );
  const options = useMemo<SelectFieldOption<string>[]>(
    () => sessions.map((session) => ({ id: session.id, value: session.id, label: session.label })),
    [sessions],
  );
  const selectedDisplay = useMemo(() => {
    const current = sessions.find((session) => session.id === selectedSessionId);
    return current ? { label: current.label } : null;
  }, [sessions, selectedSessionId]);
  const handleChange = useCallback((value: string) => onSelectSession(value), [onSelectSession]);

  // Right-hand toggles as separator-delimited clusters. Collapsed controls drop
  // out; empty clusters (and the separator that would precede them) disappear so
  // no orphan pipe is left behind — e.g. once Timeline/Files/Cost are all hidden
  // the group is just the HUD toggle with no leading separators.
  const timelineNode = hidden.has("timeline") ? null : (
    <ToolbarIconButton
      key="timeline"
      label="Timeline"
      Icon={ThemedTimeline}
      selected={!panelsDisabled && timelineOpen}
      onPress={onToggleTimeline}
      disabled={panelsDisabled}
      testID="visualizer-toolbar-timeline"
    />
  );
  const filesNode = hidden.has("files") ? null : (
    <ToolbarIconButton
      key="files"
      label="Files"
      Icon={ThemedFiles}
      selected={!panelsDisabled && filesOpen}
      onPress={onToggleFiles}
      disabled={panelsDisabled}
      testID="visualizer-toolbar-files"
    />
  );
  const costNode = hidden.has("cost") ? null : (
    <ToolbarIconButton
      key="cost"
      label="Cost"
      Icon={ThemedDollarSign}
      selected={!panelsDisabled && costOpen}
      onPress={onToggleCost}
      disabled={panelsDisabled}
      testID="visualizer-toolbar-cost"
    />
  );
  const hudNode = (
    <ToolbarIconButton
      key="hud"
      label={hudHidden ? "Show HUD" : "Hide HUD"}
      Icon={hudHidden ? ThemedEyeOff : ThemedEye}
      selected={!hudHidden}
      onPress={onToggleHud}
      testID="visualizer-toolbar-hud"
    />
  );
  // The surface switch. It lives here rather than in the workspace header
  // because it only means anything while the Visualizer is open — one header
  // button now opens the surface you last used, and you change surface from
  // inside. Momentary (no `selected`): pressing it leaves this toolbar behind.
  const pipNode =
    onCollapseToPip === null ? null : (
      <ToolbarIconButton
        key="pip"
        label="Collapse to picture-in-picture"
        Icon={ThemedPictureInPicture}
        onPress={onCollapseToPip}
        testID="visualizer-toolbar-pip"
      />
    );
  const toggleClusters = [
    { id: "timeline", nodes: [timelineNode] },
    { id: "panels", nodes: [filesNode, costNode] },
    { id: "hud", nodes: [hudNode] },
    { id: "surface", nodes: [pipNode] },
  ]
    .map((cluster) => ({
      id: cluster.id,
      nodes: cluster.nodes.filter((node): node is ReactElement => node !== null),
    }))
    .filter((cluster) => cluster.nodes.length > 0);

  return (
    <View style={styles.bar} onLayout={handleBarLayout}>
      <View style={styles.leftGroup}>
        <View style={styles.chats}>
          <SelectField<string>
            label="Chat"
            value={selectedSessionId}
            selectedDisplay={selectedDisplay}
            options={options}
            onChange={handleChange}
            placeholder={sessions.length === 0 ? "No chats" : "Select a chat"}
            emptyText="No chats to visualize"
            disabled={sessions.length === 0}
            searchable={sessions.length > 8}
            size="sm"
            triggerStyle={styles.chatsTrigger}
            field={false}
            testID="visualizer-toolbar-chats"
            triggerTestID="visualizer-toolbar-chats-trigger"
          />
        </View>
        {/* Pin freezes the graph on the current chat; unpinned, the Visualizer
            follows whichever chat tab is focused in the workspace. Highlighted
            (selected) means pinned/frozen. Disabled when there's no chat.
            Collapsed away last when the toolbar runs out of room. */}
        {hidden.has("pin") ? null : (
          <ToolbarIconButton
            label={followActive ? "Pin this chat" : "Unpin — follow the active chat"}
            Icon={followActive ? ThemedPin : ThemedPinFilled}
            selected={!followActive}
            onPress={onToggleFollow}
            disabled={sessions.length === 0}
            testID="visualizer-toolbar-follow"
          />
        )}
        <ToolbarIconButton
          label={soundMuted ? "Unmute" : "Mute"}
          Icon={soundMuted ? ThemedVolumeX : ThemedVolume2}
          selected={!soundMuted}
          onPress={onToggleAudio}
          testID="visualizer-toolbar-audio"
        />
        <ToolbarSeparator />
        {/* Canvas controls pulled out of the removed right-click context menu.
            Zoom to Fit / Toggle Stats, then a separator, then Restart. Zoom to
            Fit and Restart are momentary actions (no `selected` highlight). */}
        <ToolbarIconButton
          label="Zoom to Fit"
          Icon={ThemedFitScreen}
          onPress={onZoomToFit}
          disabled={viewportDisabled}
          testID="visualizer-toolbar-zoom-to-fit"
        />
        {hidden.has("stats") ? null : (
          <ToolbarIconButton
            label="Toggle Stats"
            Icon={ThemedBarChart}
            selected={!panelsDisabled && statsOpen}
            onPress={onToggleStats}
            disabled={panelsDisabled}
            testID="visualizer-toolbar-stats"
          />
        )}
        <ToolbarSeparator />
        <ToolbarIconButton
          label="Restart"
          Icon={ThemedRestart}
          onPress={onRestart}
          disabled={viewportDisabled}
          testID="visualizer-toolbar-restart"
        />
      </View>
      <View style={styles.toggles}>
        {toggleClusters.map((cluster, index) => (
          <Fragment key={cluster.id}>
            {index > 0 ? <ToolbarSeparator /> : null}
            {cluster.nodes}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    // Pinned so this bar matches the file editor's toolbar height even though
    // its tallest child (the shrunk 26px chat dropdown) is smaller; the
    // dropdown stays centered via alignItems. See PANE_TOOLBAR_HEIGHT.
    minHeight: PANE_TOOLBAR_HEIGHT,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  // Left cluster: chats dropdown + the audio toggle sitting to its right.
  leftGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
  },
  // Cap the chats dropdown so a long chat title doesn't push the toggles off
  // the right edge; the trigger truncates its label (numberOfLines={1}). Shares
  // the workspace tab's max width so the combo never grows wider than a tab
  // chip and ellipsizes at the same point.
  chats: {
    flexShrink: 1,
    maxWidth: TAB_MAX_WIDTH,
  },
  // Size the trigger box for the toolbar without touching the shared `sm` preset
  // or the font size. On desktop it shrinks to 26px (the sm text line is 20px, so
  // 3px vertical padding keeps it legible). On mobile it grows to 40px to match
  // the doubled icon buttons (32px glyph + 8px padding) so the combo lines up.
  chatsTrigger: {
    minHeight: {
      xs: 40,
      md: 26,
    },
    paddingVertical: 3,
  },
  toggles: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
  },
}));
