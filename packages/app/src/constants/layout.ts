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

// Max width for chat content (stream view, input area, new agent form)
export const MAX_CONTENT_WIDTH = 820;
// "Wide" chat width option — a wider fixed cap than default, but still a cap:
// on an ultra-wide monitor it stops growing here instead of tracking the
// window. Only "full" (see resolveChatMaxWidth) is meant to track the window.
export const WIDE_CONTENT_WIDTH = 1200;
export const COMPACT_FORM_FACTOR_WIDTH = 500;

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
