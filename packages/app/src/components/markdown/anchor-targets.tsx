import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Animated, Text, View } from "react-native";
import type { ASTNode, RenderRules } from "react-native-markdown-display";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { documentAnchorKey } from "./document-anchors";
import { HTML_ANCHOR_TOKEN } from "./html-anchors";

/** The one thing a document-link target has to offer: where it sits in the scroll content. */
export type MarkdownAnchorNode = Pick<View, "measureLayout">;

/**
 * How rendered anchor targets (headings, and rows or spans carrying an
 * explicit HTML id) report themselves to the reader that scrolls to them.
 * Both calls are imperative on purpose: a document can hold hundreds of
 * targets, and none of them should re-render the pane by mounting.
 */
export interface MarkdownAnchorTargets {
  /** A target mounted (`node`) or unmounted (`null`) under a `documentAnchorKey`. */
  register: (key: string, node: MarkdownAnchorNode | null) => void;
  /** A target's own layout changed, so a pending landing may need to re-measure. */
  layout: () => void;
}

export function useMarkdownAnchorRef(
  keys: readonly string[],
  anchorTargets: MarkdownAnchorTargets | undefined,
): (node: MarkdownAnchorNode | null) => void {
  const keySignature = keys.join("\n");
  return useCallback(
    (node: MarkdownAnchorNode | null) => {
      if (!anchorTargets || !keySignature) return;
      for (const key of keySignature.split("\n")) anchorTargets.register(key, node);
    },
    [anchorTargets, keySignature],
  );
}

/** Explicit HTML anchor ids anywhere under a rendered node, in document order. */
export function htmlAnchorIdsWithin(node: ASTNode): string[] {
  const ids: string[] = [];
  const visit = (current: ASTNode) => {
    if (current.type === HTML_ANCHOR_TOKEN) {
      const id = (current.attributes as Record<string, unknown>).id;
      if (typeof id === "string" && id) ids.push(id);
    }
    for (const child of current.children) visit(child);
  };
  visit(node);
  return ids;
}

function idKeys(ids: readonly string[]): string[] {
  return ids.map((value) => documentAnchorKey({ kind: "id", value }));
}

/**
 * A table row that carries anchors. The row, not the empty marker inside one
 * of its cells, is the target: it is a real box on every platform, and it is
 * the whole row the reader was sent to.
 */
function MarkdownAnchorFrame({
  ids,
  anchorTargets,
  children,
}: {
  ids: readonly string[];
  anchorTargets: MarkdownAnchorTargets;
  children: ReactNode;
}) {
  const ref = useMarkdownAnchorRef(idKeys(ids), anchorTargets);
  return (
    <View ref={ref} collapsable={false} onLayout={anchorTargets.layout}>
      {children}
    </View>
  );
}

/**
 * An anchor inside running text. It has no content, so it takes no space: on
 * web an empty inline span, on native a zero-size inline view (a nested
 * native `Text` has no layout of its own to measure).
 */
function MarkdownAnchorMarker({
  id,
  anchorTargets,
}: {
  id: string;
  anchorTargets: MarkdownAnchorTargets;
}) {
  const ref = useMarkdownAnchorRef(idKeys([id]), anchorTargets);
  if (isWeb) {
    return <Text ref={ref as never} />;
  }
  return <View ref={ref} collapsable={false} style={ZERO_SIZE} />;
}

const ZERO_SIZE = { width: 0, height: 0 };

/** Renders explicit HTML anchors as nothing: the default wherever no reader navigates to them. */
export function createHtmlAnchorPlaceholderRules(): RenderRules {
  return { [HTML_ANCHOR_TOKEN]: () => null };
}

/**
 * Make a document's explicit HTML anchors measurable. A table row holding one
 * becomes the target; an anchor anywhere else renders as an inline marker.
 */
export function withMarkdownAnchorTargetRules(
  rules: RenderRules,
  anchorTargets: MarkdownAnchorTargets,
): RenderRules {
  const renderRow = rules.tr;
  return {
    ...rules,
    tr: (node, children, parentNodes, styles, ...rest) => {
      const row = renderRow?.(node, children, parentNodes, styles, ...rest) ?? null;
      const ids = htmlAnchorIdsWithin(node);
      if (ids.length === 0) return row;
      return (
        <MarkdownAnchorFrame key={node.key} ids={ids} anchorTargets={anchorTargets}>
          {row}
        </MarkdownAnchorFrame>
      );
    },
    [HTML_ANCHOR_TOKEN]: (node, _children, parentNodes) => {
      const id = (node.attributes as Record<string, unknown>).id;
      if (typeof id !== "string" || !id) return null;
      if (parentNodes.some((parent) => parent.type === "tr")) return null;
      return <MarkdownAnchorMarker key={node.key} id={id} anchorTargets={anchorTargets} />;
    },
  };
}

export interface MarkdownAnchorLanding {
  /** Changes on every navigation, so a repeat click replays the highlight. */
  key: string;
  y: number;
  height: number;
}

const LANDING_HOLD_MS = 700;
const LANDING_FADE_MS = 900;

/**
 * A brief accent wash over the element a document link landed on, so the
 * reader can find it in a dense table. Positioned in the scroll content, not
 * the element, so it needs nothing from the rule that rendered the target.
 */
export function MarkdownAnchorLandingHighlight({
  landing,
  animated,
}: {
  landing: MarkdownAnchorLanding;
  animated: boolean;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    opacity.setValue(1);
    if (!animated) return;
    const fade = Animated.timing(opacity, {
      toValue: 0,
      delay: LANDING_HOLD_MS,
      duration: LANDING_FADE_MS,
      useNativeDriver: !isWeb,
    });
    fade.start();
    return () => fade.stop();
  }, [animated, landing.key, opacity]);
  return (
    <Animated.View
      pointerEvents="none"
      testID="markdown-anchor-landing"
      style={[
        LANDING_FRAME,
        { top: landing.y, height: landing.height, opacity: animated ? opacity : 1 },
      ]}
    >
      <View style={styles.wash} />
    </Animated.View>
  );
}

/** How long the landing highlight stays mounted, fade included. */
export const MARKDOWN_ANCHOR_LANDING_MS = LANDING_HOLD_MS + LANDING_FADE_MS;

const LANDING_FRAME = { position: "absolute" as const, left: 0, right: 0 };

const styles = StyleSheet.create((theme) => ({
  wash: {
    flex: 1,
    backgroundColor: theme.colors.accent,
    opacity: 0.16,
    borderRadius: theme.borderRadius.sm,
  },
}));
