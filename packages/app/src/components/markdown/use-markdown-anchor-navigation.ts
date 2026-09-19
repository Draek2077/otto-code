import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ScrollView, View } from "react-native";
import { extractMarkdownHeadings } from "@otto-code/highlight";
import { headingAnchors } from "@/editor/markdown/markdown-link-completion";
import {
  MARKDOWN_ANCHOR_LANDING_MS,
  type MarkdownAnchorLanding,
  type MarkdownAnchorNode,
  type MarkdownAnchorTargets,
} from "./anchor-targets";
import {
  collectHtmlAnchorIds,
  documentAnchorKey,
  resolveDocumentAnchor,
  type DocumentAnchorTarget,
} from "./document-anchors";

/**
 * After a link lands, keep the target pinned this long while late layout
 * (images, diagrams, fonts) settles above it. Past it, layout changes no
 * longer move the reader: they may have scrolled on, or be editing in split.
 */
const SETTLE_MS = 1000;
/** A zero-height marker still gets a visible band. */
const MIN_LANDING_HEIGHT = 24;
/** Cheap gate before parsing a document a second time for its anchor ids. */
const MAY_HOLD_HTML_ANCHOR_RE = /<(?:a|span)\s/i;
const EMPTY_IDS: ReadonlySet<string> = new Set();

/** State updater that keeps the current landing object when nothing moved. */
function replaceLanding(next: MarkdownAnchorLanding) {
  return (current: MarkdownAnchorLanding | null) =>
    current?.key === next.key && current.y === next.y && current.height === next.height
      ? current
      : next;
}

export interface MarkdownAnchorNavigation {
  /** Pass to the document rules so headings and explicit anchors register. */
  anchorTargets: MarkdownAnchorTargets;
  /** A fragment was requested and the document has no heading or anchor by that name. */
  anchorMissing: boolean;
  /** The element the last navigation landed on, while its highlight shows. */
  landing: MarkdownAnchorLanding | null;
  /** Call from the scroll view's `onContentSizeChange`: content above may have moved. */
  handleContentSizeChange: () => void;
}

/**
 * Follows a document link's `#fragment` in a rendered Markdown document:
 * resolves it to an explicit HTML anchor or a heading, scrolls the target to
 * the top of the reader, and briefly highlights it.
 *
 * Positions come from `measureLayout` against the scroll content, not from a
 * target's `onLayout`, whose `y` is relative to its parent and so is wrong for
 * anything nested: a table row, a heading inside a list or quote.
 */
export function useMarkdownAnchorNavigation(input: {
  body: string | null;
  fragment: string | null;
  navigationRevision: number;
  scrollRef: RefObject<ScrollView | null>;
  contentRef: RefObject<View | null>;
}): MarkdownAnchorNavigation {
  const { body, navigationRevision, scrollRef, contentRef } = input;
  const fragment = input.fragment?.trim() || null;
  const headingAnchorSet = useMemo(
    () =>
      new Set(
        body && fragment ? headingAnchors(extractMarkdownHeadings(body)).map((h) => h.anchor) : [],
      ),
    [body, fragment],
  );
  const htmlAnchorIds = useMemo(
    () =>
      body && fragment && MAY_HOLD_HTML_ANCHOR_RE.test(body)
        ? collectHtmlAnchorIds(body)
        : EMPTY_IDS,
    [body, fragment],
  );
  const target = useMemo<DocumentAnchorTarget | null>(
    () =>
      fragment
        ? resolveDocumentAnchor({ fragment, headingAnchors: headingAnchorSet, htmlAnchorIds })
        : null,
    [fragment, headingAnchorSet, htmlAnchorIds],
  );
  const targetKey = target ? documentAnchorKey(target) : null;
  const anchorMissing = Boolean(body !== null && fragment && !target);

  const nodesRef = useRef(new Map<string, MarkdownAnchorNode>());
  const activeRef = useRef<{ key: string; navigation: string; landedAt: number | null } | null>(
    null,
  );
  const frameRef = useRef<number | null>(null);
  const [landing, setLanding] = useState<MarkdownAnchorLanding | null>(null);

  const align = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    if (active.landedAt !== null && Date.now() - active.landedAt > SETTLE_MS) return;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const node = nodesRef.current.get(active.key);
      const content = contentRef.current;
      if (!node || !content || activeRef.current !== active) return;
      node.measureLayout(
        content,
        (_x, y, _width, height) => {
          if (activeRef.current !== active) return;
          scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: false });
          if (active.landedAt === null) active.landedAt = Date.now();
          // A re-pin after late layout moves the wash with the target; the
          // same key keeps its fade running rather than restarting it.
          const next = { key: active.navigation, y, height: Math.max(height, MIN_LANDING_HEIGHT) };
          setLanding(replaceLanding(next));
        },
        () => {},
      );
    });
  }, [contentRef, scrollRef]);

  const anchorTargets = useMemo<MarkdownAnchorTargets>(
    () => ({
      register: (key, node) => {
        if (node) {
          nodesRef.current.set(key, node);
        } else {
          nodesRef.current.delete(key);
        }
        if (node && activeRef.current?.key === key) align();
      },
      layout: align,
    }),
    [align],
  );

  // A new fragment, or the same one clicked again, starts a fresh landing.
  useEffect(() => {
    if (!targetKey) {
      activeRef.current = null;
      return;
    }
    activeRef.current = {
      key: targetKey,
      navigation: `${navigationRevision}:${targetKey}`,
      landedAt: null,
    };
    align();
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [align, navigationRevision, targetKey]);

  const landingKey = landing?.key ?? null;
  useEffect(() => {
    if (!landingKey) return;
    const timer = setTimeout(() => setLanding(null), MARKDOWN_ANCHOR_LANDING_MS);
    return () => clearTimeout(timer);
  }, [landingKey]);

  return { anchorTargets, anchorMissing, landing, handleContentSizeChange: align };
}
