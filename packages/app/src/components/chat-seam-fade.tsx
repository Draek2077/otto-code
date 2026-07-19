import { StyleSheet as RNStyleSheet, View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Theme } from "@/styles/theme";

const CHAT_SEAM_FADE_HEIGHT = 24;

export type ChatSeamFadeEdge = "top" | "bottom";

interface ChatSeamFadeGradientProps {
  edge: ChatSeamFadeEdge;
  color: string;
}

function ChatSeamFadeGradient({ edge, color }: ChatSeamFadeGradientProps) {
  const gradientId = `chat-seam-fade-${edge}`;
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor={color} stopOpacity={edge === "top" ? 1 : 0} />
          <Stop offset={edge === "top" ? "25%" : "75%"} stopColor={color} stopOpacity={0.5} />
          <Stop offset="100%" stopColor={color} stopOpacity={edge === "top" ? 0 : 1} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

// The fade color must flow through uniProps (not a hard-coded value): the
// pane background is `surface0` in the app theme but pure black under the
// scoped `black` theme (Black tab background setting), and on native
// ScopedTheme resolves uniProps mappings against the scoped theme.
const ThemedChatSeamFadeGradient = withUnistyles(ChatSeamFadeGradient);

const fadeColorMapping = (theme: Theme) => ({
  color: theme.colors.surface0,
});

/**
 * Inset fade along a chat pane seam: a full-width gradient from the
 * pane/active-tab background (`surface0`, pure black under the black chat
 * scope) into transparent, so chat content scrolling past that edge
 * dissolves into the surrounding chrome instead of clipping hard. Chat panes
 * only — terminal/browser/file panes render without it.
 *
 * `edge` names the seam: "top" for the tab-bar seam (opaque at the top),
 * "bottom" for the composer seam (opaque at the bottom). Neither edge
 * carries a zIndex — inside the stream view the fades must paint below the
 * desktop web scrollbar overlay (zIndex 10, `web-desktop-scrollbar.tsx`) so
 * the scrollbar stays visible over the fades, and below the scroll-to-bottom
 * button, which has no zIndex and relies on later-sibling paint order (see
 * `agent-stream/view.tsx`). Painting above the message list needs no zIndex:
 * the fades are positioned later siblings of the list.
 *
 * The web variant (`chat-seam-fade.web.tsx`) uses a CSS gradient instead of
 * SVG: `stopColor` lands as an SVG presentation attribute where `var()` does
 * not resolve, so an SVG gradient could not follow the black chat scope's
 * CSS variables there (docs/unistyles.md).
 */
export function ChatSeamFade({ edge }: { edge: ChatSeamFadeEdge }) {
  return (
    <View style={edge === "top" ? TOP_STRIP_STYLE : BOTTOM_STRIP_STYLE} pointerEvents="none">
      <ThemedChatSeamFadeGradient edge={edge} uniProps={fadeColorMapping} />
    </View>
  );
}

const styles = RNStyleSheet.create({
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
    height: CHAT_SEAM_FADE_HEIGHT,
  },
  top: {
    top: 0,
  },
  bottom: {
    bottom: 0,
  },
});

const TOP_STRIP_STYLE = [styles.strip, styles.top];
const BOTTOM_STRIP_STYLE = [styles.strip, styles.bottom];
