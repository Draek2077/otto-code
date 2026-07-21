import { useUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";

export const FOOTER_HEIGHT = 75;

// Shared header inner height (excluding safe area insets and border)
// Used by both agent header (ScreenHeader) and explorer sidebar header
// This ensures both headers have the same visual height
export const HEADER_INNER_HEIGHT = 46;
export const HEADER_INNER_HEIGHT_MOBILE = 56;
export const WORKSPACE_SECONDARY_HEADER_HEIGHT = 36;
export const HEADER_TOP_PADDING_MOBILE = 8;
// A pane's vertical tab rail (left edge) sizes itself to its widest current
// tab label, clamped between this floor and WORKSPACE_TABS_RAIL_MAX_WIDTH (see
// computeWorkspaceTabRailWidth in workspace-tab-layout.ts) — every tab in the
// rail shares that one computed width. Dragging the rail's splitter replaces
// that content-driven width outright with a saved one (AppSettings
// `verticalTabRailWidth`, one width for every rail on the device), clamped to
// the same two bounds — see workspace-desktop-tabs-rail.tsx.
export const WORKSPACE_TABS_RAIL_MIN_WIDTH = 180;
// The rail trades horizontal room for label space (labels are all it shows), so
// its ceiling is deliberately wider than a horizontal tab's TAB_MAX_WIDTH —
// 2.25x it. Re-exported as RAIL_TAB_MAX_WIDTH from workspace-tab-layout.ts,
// where the rest of the tab metrics live; it is defined here because the
// settings layer (use-settings/storage.ts) clamps the saved user width to it
// and must not reach into `screens/` to do so.
export const WORKSPACE_TABS_RAIL_MAX_WIDTH = 450;

// Max width for chat content (stream view, input area, new agent form)
export const MAX_CONTENT_WIDTH = 820;
// "Wide" chat width option — a wider fixed cap than default, but still a cap:
// on an ultra-wide monitor it stops growing here instead of tracking the
// window. Only "full" (see resolveChatMaxWidth) is meant to track the window.
export const WIDE_CONTENT_WIDTH = 1200;
export const COMPACT_FORM_FACTOR_WIDTH = 500;

// Stacking order for absolutely-positioned overlays that share the chat
// content container (siblings of the stream, inside the pane — not the web
// portal root, which has its own scale in lib/overlay-root.ts). Anything that
// floats over the conversation claims a slot here rather than picking a bare
// number, so the ordering is stated in one place instead of inferred from
// sibling paint order. The suggested-task card sits above a Visualizer PIP:
// the PIP is ambient, the card is an offer the user has to answer.
export const CHAT_PANE_OVERLAY_Z = {
  visualizerPip: 20,
  suggestedTasks: 30,
} as const;

export type ChatWidth = "default" | "wide" | "full";

// "full" returns undefined (no maxWidth at all) rather than a very large
// number — the chat surface already renders at `width: "100%"`, so removing
// the cap entirely is what actually fills the window, with no ambiguity.
export function resolveChatMaxWidth(chatWidth: ChatWidth): number | undefined {
  switch (chatWidth) {
    case "wide":
      return WIDE_CONTENT_WIDTH;
    case "full":
      return undefined;
    default:
      return MAX_CONTENT_WIDTH;
  }
}

// Desktop app constants for macOS traffic light buttons
// These buttons (close/minimize/maximize) overlay the top-left corner
export const DESKTOP_TRAFFIC_LIGHT_WIDTH = 78;
export const DESKTOP_TRAFFIC_LIGHT_HEIGHT = 45;

// Windows/Linux window controls (minimize/maximize/close) — top-right
export const DESKTOP_WINDOW_CONTROLS_WIDTH = 140;
export const DESKTOP_WINDOW_CONTROLS_HEIGHT = 48;

export {
  getIsElectron as getIsElectronRuntime,
  getIsElectronMac as getIsElectronRuntimeMac,
} from "./platform";

/**
 * Reactive hook — re-renders the component when the breakpoint changes.
 * Always use this instead of reading UnistylesRuntime.breakpoint directly.
 */
export function useIsCompactFormFactor(): boolean {
  const { rt } = useUnistyles();
  return rt.breakpoint === "xs" || rt.breakpoint === "sm";
}

/**
 * True only at the narrowest breakpoint (`xs`, below `sm` ≈ <576px) — the point
 * at which settings rows stack their controls below the label. Narrower than
 * {@link useIsCompactFormFactor}, which also includes `sm`. Reactive.
 */
export function useIsExtraCompactFormFactor(): boolean {
  const { rt } = useUnistyles();
  return rt.breakpoint === "xs";
}

// SplitContainer relies on dnd-kit and DOM-backed accessibility helpers.
// Keep that capability distinct from desktop-width layout so touch tablets
// can use the desktop shell without entering web-only code paths.
export function supportsDesktopPaneSplits(): boolean {
  return isWeb;
}
