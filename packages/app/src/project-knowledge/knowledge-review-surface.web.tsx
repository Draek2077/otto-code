/* oxlint-disable react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop -- a DOM range owns each marker. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Text as NativeText, View, type TextStyle } from "react-native";
import {
  createSharedMarkdownRules,
  MarkdownRenderer,
  type MarkdownStyles,
} from "@/components/markdown/renderer";
import { MarkdownFenceBlock } from "@/components/markdown/fence";
import { EditNote } from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { ContextMenuItem } from "@/components/ui/context-menu";
import {
  TextSelectionMenuHybridScope,
  useTextSelectionContextMenu,
} from "@/components/text-selection-menu/text-selection-menu";
import { FormTextInput } from "@/components/ui/form-field";
import { FloatingSurface } from "@/components/ui/floating";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import {
  findDomRangeForSourceAnchor,
  findSourceAnchorForDomRange,
} from "./markdown-dom-source-range.web";
import { collectMarkdownSourceMap, type MarkdownSourceFence } from "./markdown-source-map";
import type { KnowledgeReviewDirective } from "./review-session";
import type { KnowledgeReviewSurfaceProps } from "./knowledge-review-surface.types";
import type { ASTNode, RenderRules } from "react-native-markdown-display";

interface Marker {
  id: string;
  kind: KnowledgeReviewDirective["kind"];
  left: number;
  top: number;
  viewportLeft: number;
  viewportTop: number;
}

interface ReviewTheme {
  accent: string;
  border: string;
  foreground: string;
  muted: string;
  surface: string;
  elevated: string;
  replace: string;
  refine: string;
  replaceHighlight: string;
  refineHighlight: string;
}

interface ThemedProps extends KnowledgeReviewSurfaceProps {
  theme?: ReviewTheme;
}

const NOTE_KIND_OPTIONS: { value: KnowledgeReviewDirective["kind"]; label: string }[] = [
  { value: "replace", label: "Replace" },
  { value: "refine", label: "Refine" },
];
const REFINE_ONLY_NOTE_KIND_OPTIONS: { value: KnowledgeReviewDirective["kind"]; label: string }[] =
  [{ value: "refine", label: "Refine" }];

const ThemedAnnotationTextInput = withUnistyles(FormTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

const annotationStyles = StyleSheet.create((theme) => ({
  portalOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: OVERLAY_Z.floating,
  },
  popover: {
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    shadowColor: "rgba(0, 0, 0, 0.28)",
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 30,
    shadowOpacity: 1,
  },
  selection: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.xs,
    lineHeight: Math.round(theme.fontSize.xs * 1.4),
  },
  input: {
    minHeight: 132,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.45),
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
}));

/**
 * Desktop Knowledge review is deliberately source anchored, not click anchored.
 * DOM ranges exist only to paint the current document. Each directive instead
 * persists an exact Markdown source range, so duplicate rendered phrases never
 * make a replacement ambiguous and the model cannot escape its requested scope.
 */
function KnowledgeReviewSurfaceWeb({
  source,
  directiveSource,
  directives,
  enabled,
  onAdd,
  onUpdate,
  onRemove,
  onSelectionError,
  theme,
}: ThemedProps) {
  const articleRef = useRef<HTMLDivElement | null>(null);
  const rangesRef = useRef(new Map<string, Range>());
  const blockElementsRef = useRef(new Map<string, HTMLElement>());
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const textMenu = useTextSelectionContextMenu();
  const activeMarker = useMemo(
    () => markers.find((marker) => marker.id === activeId) ?? null,
    [activeId, markers],
  );
  const styleText = useMemo(() => buildHighlightCss(theme), [theme]);
  const sourceMap = useMemo(() => collectMarkdownSourceMap(directiveSource), [directiveSource]);
  const reviewRules = useMemo(() => createKnowledgeReviewMarkdownRules(), []);

  const measureMarkers = useCallback(() => {
    const article = articleRef.current;
    if (!article) return;
    const bounds = article.getBoundingClientRect();
    const next: Marker[] = [];
    for (const directive of directives) {
      const range = rangesRef.current.get(directive.id);
      const block = blockElementsRef.current.get(directive.id);
      const rect = range?.getBoundingClientRect() ?? block?.getBoundingClientRect();
      if (!rect) continue;
      if (rect.width === 0 && rect.height === 0) continue;
      next.push({
        id: directive.id,
        kind: directive.kind,
        left: Math.max(0, rect.right - bounds.left + 4),
        top: Math.max(0, rect.bottom - bounds.top + 3),
        viewportLeft: rect.right + 4,
        viewportTop: rect.bottom + 3,
      });
    }
    setMarkers(next);
  }, [directives]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const css = globalThis.CSS as typeof CSS & {
      highlights?: {
        delete: (name: string) => void;
        set: (name: string, highlight: unknown) => void;
      };
    };
    const HighlightConstructor = globalThis.Highlight as
      | (new (...ranges: Range[]) => unknown)
      | undefined;
    css.highlights?.delete("knowledge-review-replace");
    css.highlights?.delete("knowledge-review-refine");
    rangesRef.current.clear();
    blockElementsRef.current.clear();
    if (!HighlightConstructor || !css.highlights) {
      setMarkers([]);
      return;
    }
    const byKind: Record<KnowledgeReviewDirective["kind"], Range[]> = { replace: [], refine: [] };
    for (const directive of directives) {
      if (directive.anchor.kind === "text") {
        const range = findDomRangeForSourceAnchor(article, directive.anchor, sourceMap.textRuns);
        if (!range) continue;
        rangesRef.current.set(directive.id, range);
        byKind[directive.kind].push(range);
        continue;
      }
      const fence = sourceMap.fences.find((item) => item.start === directive.anchor.start);
      const element = fence ? findFenceElement(article, sourceMap.fences, fence) : null;
      if (element) blockElementsRef.current.set(directive.id, element);
    }
    for (const kind of ["replace", "refine"] as const) {
      if (byKind[kind].length > 0) {
        css.highlights.set(`knowledge-review-${kind}`, new HighlightConstructor(...byKind[kind]));
      }
    }
    measureMarkers();
    return () => {
      css.highlights?.delete("knowledge-review-replace");
      css.highlights?.delete("knowledge-review-refine");
    };
  }, [directives, measureMarkers, sourceMap]);

  useEffect(() => {
    let frame = 0;
    const requestMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureMarkers);
    };
    window.addEventListener("resize", requestMeasure);
    // Capture observes scrolling in the pane's nested ScrollView, not only the
    // browser viewport. The marker therefore follows its phrase through a long
    // article instead of being pinned to the page.
    window.addEventListener("scroll", requestMeasure, true);
    const observer = new ResizeObserver(requestMeasure);
    if (articleRef.current) observer.observe(articleRef.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", requestMeasure);
      window.removeEventListener("scroll", requestMeasure, true);
    };
  }, [measureMarkers]);

  const addDirective = useCallback(
    (directive: Omit<KnowledgeReviewDirective, "id">, kind: KnowledgeReviewDirective["kind"]) => {
      const id = onAdd({ ...directive, kind });
      window.getSelection()?.removeAllRanges();
      setActiveId(id);
    },
    [onAdd],
  );

  const openSelectionMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const article = articleRef.current;
      const selectedText = selection?.toString().trim() ?? "";
      if (!article) {
        textMenu.open(event);
        return;
      }
      let directive: Omit<KnowledgeReviewDirective, "id"> | null = null;
      const sourceRange =
        range && selectedText && article.contains(range.commonAncestorContainer)
          ? findSourceAnchorForDomRange(article, range, sourceMap.textRuns)
          : null;
      const fence = sourceRange
        ? null
        : findFenceAtEventTarget(article, event.target, sourceMap.fences);
      if (!enabled) {
        onSelectionError(null);
      } else if (sourceRange) {
        onSelectionError(null);
        directive = {
          kind: "refine",
          anchor: { kind: "text", ...sourceRange, label: selectedText },
          value: "",
        };
      } else if (fence) {
        onSelectionError(null);
        directive = {
          kind: "refine",
          anchor: {
            kind: "fence",
            start: fence.start,
            end: fence.end,
            label: fence.label,
            language: fence.language,
          },
          value: "",
        };
      } else {
        onSelectionError("This rendered item is not editable article source.");
      }

      const existingDirectiveId =
        directive === null
          ? null
          : (directives.find(
              (item) =>
                item.anchor.start === directive.anchor.start &&
                item.anchor.end === directive.anchor.end,
            )?.id ?? null);
      let beforeStandardActions: ReactNode = null;
      if (existingDirectiveId) {
        beforeStandardActions = (
          <ContextMenuItem onSelect={() => setActiveId(existingDirectiveId)}>
            Edit review note
          </ContextMenuItem>
        );
      } else if (directive) {
        beforeStandardActions = (
          <>
            {directive.anchor.kind !== "fence" ? (
              <ContextMenuItem onSelect={() => addDirective(directive, "replace")}>
                Replace selected text
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem onSelect={() => addDirective(directive, "refine")}>
              {refinementMenuLabel(directive)}
            </ContextMenuItem>
          </>
        );
      }
      textMenu.open(event, { beforeStandardActions, selectAllScope: article });
    },
    [addDirective, directives, enabled, onSelectionError, sourceMap, textMenu],
  );
  const openDirectiveAtPoint = useCallback((event: MouseEvent<HTMLDivElement>) => {
    for (const [id, range] of rangesRef.current) {
      if (
        Array.from(range.getClientRects()).some(
          (rect) =>
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom,
        )
      ) {
        setActiveId(id);
        return;
      }
    }
    for (const [id, element] of blockElementsRef.current) {
      if (element.contains(event.target as Node)) {
        setActiveId(id);
        return;
      }
    }
  }, []);

  return (
    <>
      <TextSelectionMenuHybridScope>
        <div style={{ position: "relative" }}>
          <style>{styleText}</style>
          <div
            ref={articleRef}
            onClick={openDirectiveAtPoint}
            onContextMenu={openSelectionMenu}
            style={{ position: "relative" }}
          >
            <MarkdownRenderer text={source} remoteImages="altText" rules={reviewRules} />
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              {markers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  aria-label={`Edit ${marker.kind} review note`}
                  onClick={() => setActiveId(marker.id)}
                  style={{
                    position: "absolute",
                    pointerEvents: "auto",
                    left: marker.left,
                    top: marker.top,
                    width: 22,
                    height: 22,
                    padding: 2,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 11,
                    border: `1px solid ${theme?.border ?? "#888"}`,
                    background: theme?.elevated ?? "#222",
                    color: marker.kind === "replace" ? theme?.replace : theme?.refine,
                    boxShadow: "0 2px 8px rgb(0 0 0 / 0.22)",
                    cursor: "pointer",
                  }}
                >
                  <EditNote size={14} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </TextSelectionMenuHybridScope>
      {activeMarker
        ? createPortal(
            <AnnotationEditor
              directive={directives.find((directive) => directive.id === activeMarker.id) ?? null}
              marker={activeMarker}
              onClose={() => setActiveId(null)}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />,
            getOverlayRoot(),
          )
        : null}
    </>
  );
}

function AnnotationEditor({
  directive,
  marker,
  onClose,
  onUpdate,
  onRemove,
}: {
  directive: KnowledgeReviewDirective | null;
  marker: Marker;
  onClose: () => void;
  onUpdate: KnowledgeReviewSurfaceProps["onUpdate"];
  onRemove: KnowledgeReviewSurfaceProps["onRemove"];
}) {
  if (!directive) return null;
  const width = Math.min(340, Math.max(240, window.innerWidth - 24));
  const opensRight = marker.viewportLeft + 26 + width <= window.innerWidth - 12;
  const left = opensRight
    ? marker.viewportLeft + 26
    : Math.max(12, marker.viewportLeft - width - 26);
  const top = Math.max(12, Math.min(marker.viewportTop, window.innerHeight - 220));
  return (
    <View pointerEvents="box-none" style={annotationStyles.portalOverlay}>
      <FloatingSurface
        accessibilityLabel="Review note"
        pointerEvents="auto"
        frameStyle={{
          position: "absolute",
          left,
          top,
          width,
          maxHeight: window.innerHeight - 24,
        }}
        style={annotationStyles.popover}
      >
        <NativeText numberOfLines={2} style={annotationStyles.selection}>
          {directive.anchor.label}
        </NativeText>
        <SegmentedControl
          size="sm"
          stretch
          value={directive.kind}
          options={
            directive.anchor.kind === "fence" ? REFINE_ONLY_NOTE_KIND_OPTIONS : NOTE_KIND_OPTIONS
          }
          onValueChange={(kind) => onUpdate(directive.id, { kind, value: directive.value })}
        />
        <ThemedAnnotationTextInput
          autoFocus
          // FormTextInput is native-owned after mount so it never replays a
          // stale controlled value while the reader is typing. Seed each
          // editor instance from the queued directive, and reset only when
          // the reader opens a different annotation.
          initialValue={directive.value}
          resetKey={directive.id}
          onChangeText={(value) => onUpdate(directive.id, { kind: directive.kind, value })}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          placeholder={annotationPlaceholder(directive)}
          style={annotationStyles.input}
        />
        <View style={annotationStyles.actions}>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => {
              onRemove(directive.id);
              onClose();
            }}
          >
            Remove
          </Button>
          <Button variant="outline" size="sm" onPress={onClose}>
            Done
          </Button>
        </View>
      </FloatingSurface>
    </View>
  );
}

function findFenceElement(
  article: HTMLElement,
  fences: readonly MarkdownSourceFence[],
  fence: MarkdownSourceFence,
): HTMLElement | null {
  return article.querySelector<HTMLElement>(
    `[data-knowledge-fence-token="${String(fence.tokenIndex)}"]`,
  );
}

function findFenceAtEventTarget(
  article: HTMLElement,
  target: EventTarget | null,
  fences: readonly MarkdownSourceFence[],
): MarkdownSourceFence | null {
  if (!(target instanceof Element)) return null;
  const token = target.closest<HTMLElement>("[data-knowledge-fence-token]")?.dataset
    .knowledgeFenceToken;
  const tokenIndex = token ? Number.parseInt(token, 10) : Number.NaN;
  return Number.isInteger(tokenIndex)
    ? (fences.find((fence) => fence.tokenIndex === tokenIndex) ?? null)
    : null;
}

function createKnowledgeReviewMarkdownRules(): RenderRules {
  const rules = createSharedMarkdownRules();
  rules.fence = (
    node: ASTNode,
    _children: ReactNode[],
    _parent: ASTNode[],
    styles: MarkdownStyles,
    inheritedStyles: TextStyle = {},
  ) => (
    <div key={node.key} data-knowledge-fence-token={String(node.tokenIndex)}>
      <MarkdownFenceBlock
        code={node.content}
        info={node.sourceInfo}
        phase="complete"
        inheritedStyles={inheritedStyles}
        textStyle={styles.fence}
        detectUntagged
      />
    </div>
  );
  return rules;
}

function refinementMenuLabel(directive: Omit<KnowledgeReviewDirective, "id">): string {
  if (directive.anchor.kind === "fence" && directive.anchor.language === "mermaid") {
    return "Refine diagram";
  }
  return directive.anchor.kind === "fence" ? "Refine code block" : "Refine selected text";
}

function annotationPlaceholder(directive: KnowledgeReviewDirective): string {
  if (directive.kind === "replace") return "Exact replacement text";
  if (directive.anchor.kind === "fence" && directive.anchor.language === "mermaid") {
    return "How should this diagram be improved?";
  }
  return "How should this be improved?";
}

function buildHighlightCss(theme?: ReviewTheme): string {
  return `
    ::highlight(knowledge-review-replace) { background: ${theme?.replaceHighlight ?? "rgba(234, 179, 8, 0.28)"}; text-decoration: underline 2px ${theme?.replace ?? "#eab308"}; }
    ::highlight(knowledge-review-refine) { background: ${theme?.refineHighlight ?? "rgba(59, 130, 246, 0.24)"}; text-decoration: underline 2px ${theme?.refine ?? "#3b82f6"}; }
  `;
}

const ThemedKnowledgeReviewSurface = withUnistyles(KnowledgeReviewSurfaceWeb, (theme: Theme) => ({
  theme: {
    accent: theme.colors.primary,
    border: theme.colors.border,
    foreground: theme.colors.foreground,
    muted: theme.colors.mutedForeground,
    surface: theme.colors.surface1,
    elevated: theme.colors.surface2,
    replace: theme.colors.statusWarningStrong,
    refine: theme.colors.primary,
    replaceHighlight: theme.colors.statusWarningSurface,
    refineHighlight: theme.colors.statusInfoSurface,
  },
}));

export { ThemedKnowledgeReviewSurface as KnowledgeReviewSurface };
