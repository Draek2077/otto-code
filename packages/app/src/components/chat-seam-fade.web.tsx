import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

const CHAT_SEAM_FADE_HEIGHT = 24;

export type ChatSeamFadeEdge = "top" | "bottom";

/**
 * Web variant of the chat pane's seam fade (see `chat-seam-fade.tsx`): a
 * full-width gradient from the pane/active-tab background (`surface0`) into
 * transparent along the top (tab-bar) or bottom (composer) seam.
 *
 * Implemented as a CSS gradient in a `StyleSheet.create` class instead of the
 * native SVG gradient: on web every generated class references the theme's
 * CSS variables, so the fade follows the black chat scope's re-declared
 * variables (pure black) as well as live theme switches — an SVG `stopColor`
 * presentation attribute cannot resolve `var()` (docs/unistyles.md). The
 * transparent stop is `color-mix` of the same token so the fade stays in-hue
 * instead of interpolating through transparent black.
 *
 * Neither edge carries a zIndex — inside the stream view the fades must
 * paint below the desktop web scrollbar overlay (zIndex 10,
 * `web-desktop-scrollbar.tsx`) so the scrollbar stays visible over the
 * fades, and below the scroll-to-bottom button, which has no zIndex and
 * relies on later-sibling paint order (see `agent-stream/view.tsx`).
 * Painting above the message list needs no zIndex: the fades are positioned
 * later siblings of the list.
 */
export function ChatSeamFade({ edge }: { edge: ChatSeamFadeEdge }) {
  return (
    <View style={edge === "top" ? styles.stripTop : styles.stripBottom} pointerEvents="none" />
  );
}

const styles = StyleSheet.create((theme) => ({
  stripTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: CHAT_SEAM_FADE_HEIGHT,
    ...({
      backgroundImage:
        `linear-gradient(to bottom, ${theme.colors.surface0} 0%, ` +
        `color-mix(in srgb, ${theme.colors.surface0} 50%, transparent) 25%, ` +
        `color-mix(in srgb, ${theme.colors.surface0} 0%, transparent) 100%)`,
    } as object),
  },
  stripBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: CHAT_SEAM_FADE_HEIGHT,
    ...({
      backgroundImage:
        `linear-gradient(to top, ${theme.colors.surface0} 0%, ` +
        `color-mix(in srgb, ${theme.colors.surface0} 50%, transparent) 25%, ` +
        `color-mix(in srgb, ${theme.colors.surface0} 0%, transparent) 100%)`,
    } as object),
  },
}));
