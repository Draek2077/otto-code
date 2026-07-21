import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  memo,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/diff-stat";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  FlatList,
  TextInput,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type PressableStateCallbackType,
  type FlatListProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { BORDER_WIDTH, SPACING, useIconSize, type Theme } from "@/styles/theme";
import { useIsCompactFormFactor, WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import { PANE_TOOLBAR_HEIGHT } from "@/components/ui/control-geometry";
import {
  AlignJustify,
  Archive,
  ArrowDownUp,
  Check,
  ChevronDown,
  Columns2,
  Copy,
  Download,
  FolderTree,
  GitCommitHorizontal,
  GitMerge,
  History,
  List,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Paperclip,
  Pilcrow,
  RefreshCcw,
  RotateCw,
  SquarePen,
  SquareTerminal,
  Trash2,
  Undo2,
  Upload,
  WrapText,
} from "@/components/icons/material-icons";
import {
  useCheckoutDiffQuery,
  type ParsedDiffFile,
  type DiffLine,
  type HighlightToken,
} from "@/git/use-diff-query";
import { buildDiffFlatItems, sumHeightsBefore, type DiffFlatItem } from "@/git/diff-flat-items";
import { buildDiffTree, collectDirPaths, compressSingleChildChains } from "@/git/diff-tree";
import { DiffFolderRow } from "@/git/diff-folder-row";
import { TreeIndentGuides, treeRowPaddingLeft } from "@/components/tree-primitives";
import { SvgXml } from "react-native-svg";
import { getFileIconSvg } from "@/components/material-file-icons";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { useAppSettings } from "@/hooks/use-settings";
import { DiffScroll } from "@/components/diff-scroll";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { shouldAnchorHeaderBeforeCollapse } from "@/git/diff-scroll";
import {
  buildSplitDiffRows,
  buildUnifiedDiffLines,
  type ReviewableDiffTarget,
  type SplitDiffDisplayLine,
  type SplitDiffRow,
} from "@/utils/diff-layout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  contextMenuAnchorFromEvent,
} from "@/components/ui/context-menu";
import * as Clipboard from "expo-clipboard";
import { useTextEditorFeature } from "@/editor/use-text-editor-feature";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { GitHostingIcon } from "@/components/icons/git-hosting-icon";
import { lineNumberGutterWidth } from "@/components/code-insets";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { GitActionsSplitButton } from "@/git/actions-split-button";
import { ChangesToolbar, type ChangesToolbarItem } from "@/git/changes-toolbar/toolbar";
import { toggleChangesToolbarItem, type ChangesToolbarItemId } from "@/git/changes-toolbar/items";
import { BranchSwitcher } from "@/components/branch-switcher";
import { useGitActions } from "@/git/use-actions";
import {
  CheckoutGitCommitFailedError,
  CheckoutGitRollbackFailedError,
  useCheckoutGitActionsStore,
} from "@/git/actions-store";
import type { CheckoutGitCommitError, GitHostingProviderId } from "@otto-code/protocol/messages";
import { confirmDialog, type ConfirmDialogInput } from "@/utils/confirm-dialog";
import { Button } from "@/components/ui/button";
import { openGitLogTab } from "@/git/open-git-log-tab";
import { openFileHistoryTab } from "@/git/file-history/open-file-history-tab";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { usePanelStore } from "@/stores/panel-store";
import { buildWorkspaceExplorerStateKey } from "@/hooks/use-file-explorer-actions";
import {
  formatDiffContentText,
  formatDiffGutterText,
  hasVisibleDiffTokens,
} from "@/utils/diff-rendering";
import { isWeb, isNative } from "@/constants/platform";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachments,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import {
  buildReviewDraftScopeKey,
  buildReviewDraftKey,
  useClearReviewDraft,
  useReviewAttachmentSnapshot,
  useReviewCommentCount,
  useResolvedDiffMode,
  useSetDiffModeOverride,
  type ReviewDraftComment,
  getInlineReviewThreadState,
  getSplitInlineReviewThreadState,
  InlineReviewGutterCell,
  InlineReviewThread,
  isInlineReviewEditorForTarget,
  useInlineReviewController,
  type InlineReviewActions,
} from "@/review";

export type { GitActionId, GitAction, GitActions } from "@/git/policy";

function fileHeaderPressableStyle({ pressed }: PressableStateCallbackType) {
  return [styles.fileHeader, pressed && styles.fileHeaderPressed];
}

interface HighlightedTextProps {
  tokens: HighlightToken[];
  textMetricsStyle: TextStyle;
  wrapLines?: boolean;
  testID?: string;
}

type WrappedWebTextStyle = TextStyle & {
  whiteSpace?: "pre" | "pre-wrap";
  overflowWrap?: "normal" | "anywhere";
};

function getWrappedTextStyle(wrapLines: boolean): WrappedWebTextStyle | undefined {
  if (isNative) {
    return undefined;
  }
  return wrapLines
    ? { whiteSpace: "pre-wrap", overflowWrap: "anywhere" }
    : { whiteSpace: "pre", overflowWrap: "normal" };
}

function getNumericLineHeight(textMetricsStyle: TextStyle): number | undefined {
  const { lineHeight } = textMetricsStyle;
  return typeof lineHeight === "number" && Number.isFinite(lineHeight) ? lineHeight : undefined;
}

function useDiffRowMetricsStyle(textMetricsStyle: TextStyle): StyleProp<ViewStyle> {
  const lineHeight = getNumericLineHeight(textMetricsStyle);
  return useMemo(
    () => (lineHeight !== undefined ? inlineUnistylesStyle({ minHeight: lineHeight }) : null),
    [lineHeight],
  );
}

function HighlightedToken({ token }: { token: HighlightToken }) {
  return <Text style={syntaxTokenStyleFor(token.style)}>{token.text}</Text>;
}

function HighlightedText({
  tokens,
  textMetricsStyle,
  wrapLines = false,
  testID,
}: HighlightedTextProps) {
  const containerStyle = useMemo(
    () => [
      styles.diffTextMetrics,
      textMetricsStyle,
      styles.diffLineText,
      getWrappedTextStyle(wrapLines),
    ],
    [textMetricsStyle, wrapLines],
  );

  const keyedTokens = useMemo(
    () => tokens.map((token, index) => ({ key: `${index}-${token.text}`, token })),
    [tokens],
  );

  return (
    <Text style={containerStyle} testID={testID}>
      {keyedTokens.map(({ key, token }) => (
        <HighlightedToken key={key} token={token} />
      ))}
    </Text>
  );
}

interface DiffFileSectionProps {
  file: ParsedDiffFile;
  isExpanded: boolean;
  /** Tree indentation level (0 on the flat/mobile path). */
  depth?: number;
  /** Show the muted directory suffix (flat list); false inside the folder tree. */
  showDir?: boolean;
  /** Commit selection checkbox (uncommitted mode with a commit-capable host). */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: (path: string) => void;
  onToggle: (path: string) => void;
  onHeaderHeightChange?: (path: string, height: number) => void;
  onShowContextMenu?: (input: DiffContextMenuRequest) => void;
  testID?: string;
}

const EMPTY_COMMENTS: readonly ReviewDraftComment[] = [];

/** Right-click target for the pane-level context menu (web only). */
interface DiffContextMenuRequest {
  path: string;
  /** 1-based line in the current file, when the click landed on a diff line. */
  lineStart?: number;
  x: number;
  y: number;
}

type LineContextMenuHandler = (input: {
  target: ReviewableDiffTarget;
  x: number;
  y: number;
}) => void;

function noopStartComment(): void {}

const DIFF_LINE_HOVER_STYLE = isWeb ? ({ cursor: "auto" } as const) : null;

function LongPressableLine({
  reviewTarget,
  reviewActions,
  onHoverChange,
  hoverTargetKey,
  onHoverTargetChange,
  onLineContextMenu,
  style,
  children,
}: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  reviewActions: InlineReviewActions | undefined;
  onHoverChange?: (hovered: boolean) => void;
  hoverTargetKey?: string | null;
  onHoverTargetChange?: (key: string | null) => void;
  onLineContextMenu?: LineContextMenuHandler;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const onStartComment = reviewActions?.onStartComment;
  const handlePress = useCallback(() => {
    if (reviewTarget && onStartComment) {
      onStartComment(reviewTarget);
    }
  }, [reviewTarget, onStartComment]);

  const handleHoverIn = useCallback(() => {
    onHoverChange?.(true);
    if (hoverTargetKey) {
      onHoverTargetChange?.(hoverTargetKey);
    }
  }, [hoverTargetKey, onHoverChange, onHoverTargetChange]);
  const handleHoverOut = useCallback(() => {
    onHoverChange?.(false);
    if (hoverTargetKey) {
      onHoverTargetChange?.(null);
    }
  }, [hoverTargetKey, onHoverChange, onHoverTargetChange]);
  const handleContextMenu = useCallback(
    (event: unknown) => {
      if (!reviewTarget || !onLineContextMenu) {
        return;
      }
      const anchor = contextMenuAnchorFromEvent(event);
      if (!anchor) {
        return;
      }
      onLineContextMenu({ target: reviewTarget, x: anchor.x, y: anchor.y });
    },
    [onLineContextMenu, reviewTarget],
  );
  const hoverStyle = useMemo(() => [style, DIFF_LINE_HOVER_STYLE], [style]);

  const hasContextMenu = Boolean(reviewTarget && onLineContextMenu);
  if (isWeb && (onHoverChange || onHoverTargetChange || hasContextMenu)) {
    return (
      <Pressable
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        // @ts-ignore - onContextMenu is web-only and not in RN types.
        onContextMenu={hasContextMenu ? handleContextMenu : undefined}
        style={hoverStyle}
      >
        {children}
      </Pressable>
    );
  }

  if (!isNative || !reviewTarget || !onStartComment) {
    return <View style={style}>{children}</View>;
  }
  return (
    <Pressable onPress={handlePress} style={style}>
      {children}
    </Pressable>
  );
}

function lineTypeBackground(type: DiffLine["type"] | undefined | null) {
  if (!type) return styles.emptySplitCell;
  if (type === "add") return styles.addLineContainer;
  if (type === "remove") return styles.removeLineContainer;
  if (type === "header") return styles.headerLineContainer;
  return styles.contextLineContainer;
}

function DiffGutterCell({
  lineNumber,
  type,
  gutterWidth,
  textMetricsStyle,
  reviewTarget,
  reviewActions,
  isLineHovered,
  style,
  textTestID,
  actionTestID,
}: {
  lineNumber: number | null;
  type: DiffLine["type"] | undefined | null;
  gutterWidth: number;
  textMetricsStyle: TextStyle;
  reviewTarget?: ReviewableDiffTarget | null;
  reviewActions?: InlineReviewActions;
  isLineHovered?: boolean;
  style?: StyleProp<ViewStyle>;
  textTestID?: string;
  actionTestID?: string;
}) {
  const lineHeight = getNumericLineHeight(textMetricsStyle);
  const rowMetricsStyle = useDiffRowMetricsStyle(textMetricsStyle);
  const containerStyle = useMemo(
    () => [
      styles.gutterCell,
      lineTypeBackground(type),
      rowMetricsStyle,
      inlineUnistylesStyle({ width: gutterWidth }),
      style,
    ],
    [type, rowMetricsStyle, gutterWidth, style],
  );
  const textStyle = useMemo(
    () => [
      styles.diffTextMetrics,
      textMetricsStyle,
      styles.lineNumberText,
      type === "add" && styles.addLineNumberText,
      type === "remove" && styles.removeLineNumberText,
    ],
    [textMetricsStyle, type],
  );
  const comments = useMemo(
    () =>
      reviewTarget
        ? (reviewActions?.commentsByTarget.get(reviewTarget.key) ?? EMPTY_COMMENTS)
        : EMPTY_COMMENTS,
    [reviewTarget, reviewActions?.commentsByTarget],
  );
  const isEditorOpen = isInlineReviewEditorForTarget(reviewActions?.editor ?? null, reviewTarget);
  const onStartComment = reviewActions?.onStartComment ?? noopStartComment;

  return (
    <InlineReviewGutterCell
      reviewTarget={reviewTarget}
      comments={comments}
      isEditorOpen={isEditorOpen}
      isLineHovered={isLineHovered}
      lineHeight={lineHeight}
      onStartComment={onStartComment}
      style={containerStyle}
      actionTestID={actionTestID}
    >
      <Text numberOfLines={1} style={textStyle} testID={textTestID}>
        {formatDiffGutterText(lineNumber)}
      </Text>
    </InlineReviewGutterCell>
  );
}

function DiffTextLine({
  line,
  wrapLines,
  textMetricsStyle,
  reviewTarget,
  reviewActions,
  onHoverChange,
  hoverTargetKey,
  onHoverTargetChange,
  onLineContextMenu,
  textTestID,
}: {
  line: DiffLine;
  wrapLines: boolean;
  textMetricsStyle: TextStyle;
  reviewTarget?: ReviewableDiffTarget | null;
  reviewActions?: InlineReviewActions;
  onHoverChange?: (hovered: boolean) => void;
  hoverTargetKey?: string | null;
  onHoverTargetChange?: (key: string | null) => void;
  onLineContextMenu?: LineContextMenuHandler;
  textTestID?: string;
}) {
  const visibleTokens = hasVisibleDiffTokens(line.tokens) ? line.tokens : null;
  const rowMetricsStyle = useDiffRowMetricsStyle(textMetricsStyle);

  const containerStyle = useMemo(
    () => [styles.textLineContainer, lineTypeBackground(line.type), rowMetricsStyle],
    [line.type, rowMetricsStyle],
  );
  const textStyle = useMemo(
    () => [
      styles.diffTextMetrics,
      textMetricsStyle,
      styles.diffLineText,
      getWrappedTextStyle(wrapLines),
      line.type === "add" && styles.addLineText,
      line.type === "remove" && styles.removeLineText,
      line.type === "header" && styles.headerLineText,
      line.type === "context" && styles.contextLineText,
    ],
    [line.type, textMetricsStyle, wrapLines],
  );

  return (
    <LongPressableLine
      reviewTarget={reviewTarget}
      reviewActions={reviewActions}
      onHoverChange={onHoverChange}
      hoverTargetKey={hoverTargetKey}
      onHoverTargetChange={onHoverTargetChange}
      onLineContextMenu={onLineContextMenu}
      style={containerStyle}
    >
      {line.type !== "header" && visibleTokens ? (
        <HighlightedText
          tokens={visibleTokens}
          textMetricsStyle={textMetricsStyle}
          wrapLines={wrapLines}
          testID={textTestID}
        />
      ) : (
        <Text style={textStyle} testID={textTestID}>
          {formatDiffContentText(line.content)}
        </Text>
      )}
    </LongPressableLine>
  );
}

function SplitTextLine({
  line,
  wrapLines,
  textMetricsStyle,
  reviewActions,
  onHoverChange,
  hoverTargetKey,
  onHoverTargetChange,
  onLineContextMenu,
}: {
  line: SplitDiffDisplayLine | null;
  wrapLines: boolean;
  textMetricsStyle: TextStyle;
  reviewActions?: InlineReviewActions;
  onHoverChange?: (hovered: boolean) => void;
  hoverTargetKey?: string | null;
  onHoverTargetChange?: (key: string | null) => void;
  onLineContextMenu?: LineContextMenuHandler;
}) {
  const visibleTokens = line && hasVisibleDiffTokens(line.tokens) ? line.tokens : null;
  const rowMetricsStyle = useDiffRowMetricsStyle(textMetricsStyle);

  const containerStyle = useMemo(
    () => [styles.textLineContainer, lineTypeBackground(line?.type), rowMetricsStyle],
    [line?.type, rowMetricsStyle],
  );
  const textStyle = useMemo(
    () => [
      styles.diffTextMetrics,
      textMetricsStyle,
      styles.diffLineText,
      getWrappedTextStyle(wrapLines),
      line?.type === "add" && styles.addLineText,
      line?.type === "remove" && styles.removeLineText,
      line?.type === "context" && styles.contextLineText,
      !line && styles.emptySplitCellText,
    ],
    [line, textMetricsStyle, wrapLines],
  );

  return (
    <LongPressableLine
      reviewTarget={line?.reviewTarget}
      reviewActions={reviewActions}
      onHoverChange={onHoverChange}
      hoverTargetKey={hoverTargetKey}
      onHoverTargetChange={onHoverTargetChange}
      onLineContextMenu={onLineContextMenu}
      style={containerStyle}
    >
      {visibleTokens ? (
        <HighlightedText
          tokens={visibleTokens}
          textMetricsStyle={textMetricsStyle}
          wrapLines={wrapLines}
        />
      ) : (
        <Text style={textStyle}>{formatDiffContentText(line?.content)}</Text>
      )}
    </LongPressableLine>
  );
}

function DiffLineView({
  line,
  lineNumber,
  gutterWidth,
  wrapLines,
  textMetricsStyle,
  reviewTarget,
  reviewActions,
  onLineContextMenu,
}: {
  line: DiffLine;
  lineNumber: number | null;
  gutterWidth: number;
  wrapLines: boolean;
  textMetricsStyle: TextStyle;
  reviewTarget?: ReviewableDiffTarget | null;
  reviewActions?: InlineReviewActions;
  onLineContextMenu?: LineContextMenuHandler;
}) {
  const [isLineHovered, setIsLineHovered] = useState(false);
  const visibleTokens = hasVisibleDiffTokens(line.tokens) ? line.tokens : null;
  const rowMetricsStyle = useDiffRowMetricsStyle(textMetricsStyle);

  const containerStyle = useMemo(
    () => [styles.diffLineContainer, lineTypeBackground(line.type), rowMetricsStyle],
    [line.type, rowMetricsStyle],
  );
  const textStyle = useMemo(
    () => [
      styles.diffTextMetrics,
      textMetricsStyle,
      styles.diffLineText,
      getWrappedTextStyle(wrapLines),
      line.type === "add" && styles.addLineText,
      line.type === "remove" && styles.removeLineText,
      line.type === "header" && styles.headerLineText,
      line.type === "context" && styles.contextLineText,
    ],
    [line.type, textMetricsStyle, wrapLines],
  );

  return (
    <LongPressableLine
      reviewTarget={reviewTarget}
      reviewActions={reviewActions}
      onHoverChange={setIsLineHovered}
      onLineContextMenu={onLineContextMenu}
      style={containerStyle}
    >
      <DiffGutterCell
        lineNumber={lineNumber}
        type={line.type}
        gutterWidth={gutterWidth}
        textMetricsStyle={textMetricsStyle}
        reviewTarget={reviewTarget}
        reviewActions={reviewActions}
        isLineHovered={isLineHovered}
        style={styles.lineNumberGutter}
      />
      {line.type !== "header" && visibleTokens ? (
        <HighlightedText
          tokens={visibleTokens}
          textMetricsStyle={textMetricsStyle}
          wrapLines={wrapLines}
        />
      ) : (
        <Text style={textStyle}>{formatDiffContentText(line.content)}</Text>
      )}
    </LongPressableLine>
  );
}

function SplitDiffLine({
  line,
  gutterWidth,
  wrapLines,
  textMetricsStyle,
  reviewActions,
  onLineContextMenu,
}: {
  line: SplitDiffDisplayLine | null;
  gutterWidth: number;
  wrapLines: boolean;
  textMetricsStyle: TextStyle;
  reviewActions?: InlineReviewActions;
  onLineContextMenu?: LineContextMenuHandler;
}) {
  const [isLineHovered, setIsLineHovered] = useState(false);
  const visibleTokens = line && hasVisibleDiffTokens(line.tokens) ? line.tokens : null;
  const rowMetricsStyle = useDiffRowMetricsStyle(textMetricsStyle);

  const containerStyle = useMemo(
    () => [styles.diffLineContainer, lineTypeBackground(line?.type), rowMetricsStyle],
    [line?.type, rowMetricsStyle],
  );
  const textStyle = useMemo(
    () => [
      styles.diffTextMetrics,
      textMetricsStyle,
      styles.diffLineText,
      getWrappedTextStyle(wrapLines),
      line?.type === "add" && styles.addLineText,
      line?.type === "remove" && styles.removeLineText,
      line?.type === "context" && styles.contextLineText,
      !line && styles.emptySplitCellText,
    ],
    [line, textMetricsStyle, wrapLines],
  );

  return (
    <LongPressableLine
      reviewTarget={line?.reviewTarget}
      reviewActions={reviewActions}
      onHoverChange={setIsLineHovered}
      onLineContextMenu={onLineContextMenu}
      style={containerStyle}
    >
      <DiffGutterCell
        lineNumber={line?.lineNumber ?? null}
        type={line?.type}
        gutterWidth={gutterWidth}
        textMetricsStyle={textMetricsStyle}
        reviewTarget={line?.reviewTarget}
        reviewActions={reviewActions}
        isLineHovered={isLineHovered}
        style={styles.lineNumberGutter}
      />
      {visibleTokens ? (
        <HighlightedText
          tokens={visibleTokens}
          textMetricsStyle={textMetricsStyle}
          wrapLines={wrapLines}
        />
      ) : (
        <Text style={textStyle}>{formatDiffContentText(line?.content)}</Text>
      )}
    </LongPressableLine>
  );
}

function InlineReviewThreadContent({
  reviewTarget,
  reviewActions,
  reservedHeight,
  viewportWidth,
  pinToViewport,
}: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  reviewActions?: InlineReviewActions;
  reservedHeight?: number;
  viewportWidth?: number;
  pinToViewport?: boolean;
}) {
  const threadState = getInlineReviewThreadState({ reviewTarget, reviewActions });
  const height = reservedHeight ?? threadState?.height ?? 0;
  const placeholderStyle = useMemo<ViewStyle>(
    () => inlineUnistylesStyle({ minHeight: height }),
    [height],
  );
  if (height === 0) {
    return null;
  }
  if (!reviewTarget || !reviewActions || !threadState) {
    return <View style={placeholderStyle} />;
  }

  return (
    <InlineReviewThread
      reviewTarget={reviewTarget}
      reviewActions={reviewActions}
      height={height}
      viewportWidth={viewportWidth}
      pinToViewport={pinToViewport}
      testID={`review-thread-${reviewTarget.key}`}
    />
  );
}

function InlineReviewGutterSpacer({
  reviewTarget,
  reviewActions,
  gutterWidth,
  reservedHeight,
  style,
}: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  reviewActions?: InlineReviewActions;
  gutterWidth: number;
  reservedHeight?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const threadState = getInlineReviewThreadState({ reviewTarget, reviewActions });
  const height = reservedHeight ?? threadState?.height ?? 0;
  const spacerStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      styles.inlineReviewGutterSpacer,
      inlineUnistylesStyle({ width: gutterWidth, minHeight: height }),
      style,
    ],
    [gutterWidth, height, style],
  );
  if (height === 0) {
    return null;
  }

  return <View style={spacerStyle} />;
}

function InlineReviewRow({
  reviewTarget,
  reviewActions,
  gutterWidth,
  reservedHeight,
}: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  reviewActions?: InlineReviewActions;
  gutterWidth: number;
  reservedHeight?: number;
}) {
  const threadState = getInlineReviewThreadState({ reviewTarget, reviewActions });
  const height = reservedHeight ?? threadState?.height ?? 0;
  const gutterSpacerStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.inlineReviewGutterSpacer, inlineUnistylesStyle({ width: gutterWidth })],
    [gutterWidth],
  );
  const placeholderStyle = useMemo<ViewStyle>(
    () => inlineUnistylesStyle({ minHeight: height }),
    [height],
  );
  if (height === 0) {
    return null;
  }

  return (
    <View style={styles.inlineReviewRow}>
      <View style={gutterSpacerStyle} />
      {reviewTarget && reviewActions && threadState ? (
        <InlineReviewThread
          reviewTarget={reviewTarget}
          reviewActions={reviewActions}
          height={height}
          testID={`review-thread-${reviewTarget.key}`}
        />
      ) : (
        <View style={placeholderStyle} />
      )}
    </View>
  );
}

function SplitDiffColumn({
  rows,
  side,
  gutterWidth,
  wrapLines,
  textMetricsStyle,
  reviewActions,
  onLineContextMenu,
  showDivider = false,
}: {
  rows: SplitDiffRow[];
  side: "left" | "right";
  gutterWidth: number;
  wrapLines: boolean;
  textMetricsStyle: TextStyle;
  reviewActions?: InlineReviewActions;
  onLineContextMenu?: LineContextMenuHandler;
  showDivider?: boolean;
}) {
  const [scrollWidth, setScrollWidth] = useState(0);
  const [hoveredReviewTargetKey, setHoveredReviewTargetKey] = useState<string | null>(null);

  const wrapCellStyle = useMemo(
    () => [styles.splitCell, showDivider && styles.splitCellWithDivider],
    [showDivider],
  );
  const rowCellStyle = useMemo(
    () => [styles.splitCell, showDivider && styles.splitCellWithDivider, styles.splitCellRow],
    [showDivider],
  );
  const linesContainerRowStyle = useMemo(
    () => [
      styles.linesContainer,
      scrollWidth > 0 && inlineUnistylesStyle({ minWidth: scrollWidth }),
    ],
    [scrollWidth],
  );
  const headerLineTextStyle = useMemo(
    () => [styles.diffTextMetrics, textMetricsStyle, styles.diffLineText, styles.headerLineText],
    [textMetricsStyle],
  );

  const keyedRows = useMemo(() => rows.map((row, i) => ({ key: `row-${i}`, row })), [rows]);

  if (wrapLines) {
    return (
      <View style={wrapCellStyle}>
        <View style={styles.linesContainer}>
          {keyedRows.map(({ key, row }) => {
            if (row.kind === "header") {
              return (
                <View key={key} style={styles.splitHeaderRow}>
                  <Text style={headerLineTextStyle}>{row.content}</Text>
                </View>
              );
            }
            const line = side === "left" ? row.left : row.right;
            const reviewRowState = getSplitInlineReviewThreadState({
              left: row.left?.reviewTarget,
              right: row.right?.reviewTarget,
              reviewActions,
            });
            return (
              <View key={key}>
                <SplitDiffLine
                  line={line}
                  gutterWidth={gutterWidth}
                  wrapLines={wrapLines}
                  textMetricsStyle={textMetricsStyle}
                  reviewActions={reviewActions}
                  onLineContextMenu={onLineContextMenu}
                />
                <InlineReviewRow
                  reviewTarget={line?.reviewTarget}
                  reviewActions={reviewActions}
                  gutterWidth={gutterWidth}
                  reservedHeight={reviewRowState?.height}
                />
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={rowCellStyle}>
      <View style={styles.gutterColumn}>
        {keyedRows.map(({ key, row }) => {
          if (row.kind === "header") {
            return (
              <DiffGutterCell
                key={key}
                lineNumber={null}
                type="header"
                gutterWidth={gutterWidth}
                textMetricsStyle={textMetricsStyle}
              />
            );
          }
          const line = side === "left" ? row.left : row.right;
          const reviewTargetKey = line?.reviewTarget?.key ?? null;
          const reviewRowState = getSplitInlineReviewThreadState({
            left: row.left?.reviewTarget,
            right: row.right?.reviewTarget,
            reviewActions,
          });
          return (
            <View key={key}>
              <DiffGutterCell
                lineNumber={line?.lineNumber ?? null}
                type={line?.type}
                gutterWidth={gutterWidth}
                textMetricsStyle={textMetricsStyle}
                reviewTarget={line?.reviewTarget}
                reviewActions={reviewActions}
                isLineHovered={
                  reviewTargetKey !== null && hoveredReviewTargetKey === reviewTargetKey
                }
              />
              <InlineReviewGutterSpacer
                reviewTarget={line?.reviewTarget}
                reviewActions={reviewActions}
                gutterWidth={gutterWidth}
                reservedHeight={reviewRowState?.height}
              />
            </View>
          );
        })}
      </View>
      <DiffScroll
        scrollViewWidth={scrollWidth}
        onScrollViewWidthChange={setScrollWidth}
        style={styles.splitColumnScroll}
        contentContainerStyle={styles.diffContentInner}
      >
        <View style={linesContainerRowStyle}>
          {keyedRows.map(({ key, row }) => {
            if (row.kind === "header") {
              return (
                <View key={key} style={styles.splitHeaderRow}>
                  <Text style={headerLineTextStyle}>{row.content}</Text>
                </View>
              );
            }
            const line = side === "left" ? row.left : row.right;
            const reviewTargetKey = line?.reviewTarget?.key ?? null;
            const reviewRowState = getSplitInlineReviewThreadState({
              left: row.left?.reviewTarget,
              right: row.right?.reviewTarget,
              reviewActions,
            });
            return (
              <View key={key}>
                <SplitTextLine
                  line={line}
                  wrapLines={false}
                  textMetricsStyle={textMetricsStyle}
                  reviewActions={reviewActions}
                  hoverTargetKey={reviewTargetKey}
                  onHoverTargetChange={setHoveredReviewTargetKey}
                  onLineContextMenu={onLineContextMenu}
                />
                <InlineReviewThreadContent
                  reviewTarget={line?.reviewTarget}
                  reviewActions={reviewActions}
                  reservedHeight={reviewRowState?.height}
                  viewportWidth={scrollWidth}
                  pinToViewport
                />
              </View>
            );
          })}
        </View>
      </DiffScroll>
    </View>
  );
}

const DiffFileHeader = memo(function DiffFileHeader({
  file,
  isExpanded,
  depth = 0,
  showDir = true,
  selectable = false,
  selected = false,
  onToggleSelected,
  onToggle,
  onHeaderHeightChange,
  onShowContextMenu,
  testID,
}: DiffFileSectionProps) {
  const { t } = useTranslation();

  const handleToggleSelected = useCallback(
    (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      onToggleSelected?.(file.path);
    },
    [file.path, onToggleSelected],
  );
  const checkboxAccessibilityState = useMemo(() => ({ checked: selected }), [selected]);
  const layoutYRef = useRef<number | null>(null);
  const pressHandledRef = useRef(false);
  const pressInRef = useRef<{ ts: number; pageX: number; pageY: number } | null>(null);

  const toggleExpanded = useCallback(() => {
    pressHandledRef.current = true;
    onToggle(file.path);
  }, [file.path, onToggle]);

  const handleContextMenu = useCallback(
    (event: unknown) => {
      if (!onShowContextMenu) {
        return;
      }
      const anchor = contextMenuAnchorFromEvent(event);
      if (!anchor) {
        return;
      }
      onShowContextMenu({ path: file.path, x: anchor.x, y: anchor.y });
    },
    [file.path, onShowContextMenu],
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      layoutYRef.current = event.nativeEvent.layout.y;
      onHeaderHeightChange?.(file.path, event.nativeEvent.layout.height);
    },
    [file.path, onHeaderHeightChange],
  );

  const handlePressIn = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    pressHandledRef.current = false;
    pressInRef.current = {
      ts: Date.now(),
      pageX: event.nativeEvent.pageX,
      pageY: event.nativeEvent.pageY,
    };
  }, []);

  const handlePressOut = useCallback(
    (event: { nativeEvent: { pageX: number; pageY: number } }) => {
      if (isNative && !pressHandledRef.current && layoutYRef.current === 0 && pressInRef.current) {
        const durationMs = Date.now() - pressInRef.current.ts;
        const dx = event.nativeEvent.pageX - pressInRef.current.pageX;
        const dy = event.nativeEvent.pageY - pressInRef.current.pageY;
        const distance = Math.hypot(dx, dy);
        if (durationMs <= 500 && distance <= 12) {
          toggleExpanded();
        }
      }
    },
    [toggleExpanded],
  );

  const containerStyle = useMemo(
    () => [styles.fileSectionHeaderContainer, isExpanded && styles.fileSectionHeaderExpanded],
    [isExpanded],
  );

  const headerPressableStyle = useCallback(
    (state: PressableStateCallbackType) =>
      depth > 0
        ? [
            fileHeaderPressableStyle(state),
            inlineUnistylesStyle({ paddingLeft: treeRowPaddingLeft(depth) }),
          ]
        : fileHeaderPressableStyle(state),
    [depth],
  );

  const fileName = file.path.split("/").pop() ?? file.path;

  return (
    <View style={containerStyle} onLayout={handleLayout} testID={testID}>
      <TreeIndentGuides depth={depth} />
      <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <Pressable
            testID={testID ? `${testID}-toggle` : undefined}
            style={headerPressableStyle}
            // Android: prevent parent pan/scroll gestures from canceling the tap release.
            cancelable={false}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onPress={toggleExpanded}
            // @ts-ignore - onContextMenu is web-only and not in RN types.
            onContextMenu={onShowContextMenu ? handleContextMenu : undefined}
          >
            <View style={styles.fileHeaderLeft}>
              {selectable ? (
                <Pressable
                  style={selected ? SELECTED_FILE_CHECKBOX_STYLE : styles.fileCheckbox}
                  onPress={handleToggleSelected}
                  accessibilityRole="checkbox"
                  accessibilityState={checkboxAccessibilityState}
                  aria-checked={selected}
                  accessibilityLabel={t("workspace.git.commit.includeFile", { fileName })}
                  hitSlop={6}
                  testID={testID ? `${testID}-checkbox` : undefined}
                >
                  {selected ? (
                    <ThemedCheck size={12} uniProps={accentForegroundIconColorMapping} />
                  ) : null}
                </Pressable>
              ) : null}
              {showDir ? null : (
                <View style={styles.fileIcon}>
                  <SvgXml xml={getFileIconSvg(fileName)} width={16} height={16} />
                </View>
              )}
              <Text style={styles.fileName} numberOfLines={1}>
                {fileName}
              </Text>
              {showDir ? (
                <Text style={styles.fileDir} numberOfLines={1}>
                  {file.path.includes("/")
                    ? ` ${file.path.slice(0, file.path.lastIndexOf("/"))}`
                    : ""}
                </Text>
              ) : (
                // Flex spacer in tree mode (no dir suffix) so the New/Deleted badge
                // stays right-aligned next to the diff stats, as in the flat list.
                <View style={styles.fileDirSpacer} />
              )}
              {file.isNew && (
                <View style={styles.newBadge}>
                  <Text style={styles.newBadgeText}>{t("workspace.git.diff.newFile")}</Text>
                </View>
              )}
              {file.isDeleted && (
                <View style={styles.deletedBadge}>
                  <Text style={styles.deletedBadgeText}>{t("workspace.git.diff.deletedFile")}</Text>
                </View>
              )}
            </View>
            <View style={styles.fileHeaderRight}>
              <DiffStat additions={file.additions} deletions={file.deletions} />
            </View>
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" offset={6} maxWidth={520}>
          <Text style={styles.tooltipText}>{file.path}</Text>
        </TooltipContent>
      </Tooltip>
    </View>
  );
});

// A single expanded diff body renders every line as its own view stack — the
// body is NOT internally virtualized (only the outer file list is). One
// enormous file therefore mounts tens of thousands of views and stalls/crashes
// the app (e.g. via "expand all"). The server already caps a file's diff at 1MB
// of bytes; this additionally caps the rendered *line* count, past which the
// body collapses to the same "too large" placeholder used for over-size and
// binary files. Tune if large-but-reviewable diffs get cut off unexpectedly.
const MAX_RENDERED_DIFF_LINES = 2000;

/** Cheap, short-circuiting check: would this file's diff exceed the render cap? */
function isDiffBodyTooLargeToRender(file: ParsedDiffFile): boolean {
  let lineCount = 0;
  for (const hunk of file.hunks) {
    lineCount += hunk.lines.length;
    if (lineCount > MAX_RENDERED_DIFF_LINES) {
      return true;
    }
  }
  return false;
}

// Expanding thousands of files at once mounts thousands of diff bodies and blows
// up the list's layout math (getItemLayout is superlinear over the item list).
// Past this many changed files, "expand all" is disabled — files can still be
// expanded individually, and each over-cap file is itself placeholdered above.
const MAX_EXPAND_ALL_FILE_COUNT = 500;

function DiffFileBody({
  file,
  layout,
  wrapLines,
  codeFontSize,
  textMetricsStyle,
  reviewActions,
  onLineContextMenu,
  onBodyHeightChange,
  testID,
}: {
  file: ParsedDiffFile;
  layout: "unified" | "split";
  wrapLines: boolean;
  codeFontSize: number;
  textMetricsStyle: TextStyle;
  reviewActions?: InlineReviewActions;
  onLineContextMenu?: LineContextMenuHandler;
  onBodyHeightChange?: (file: ParsedDiffFile, height: number) => void;
  testID?: string;
}) {
  const [scrollViewWidth, setScrollViewWidth] = useState(0);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [hoveredReviewTargetKey, setHoveredReviewTargetKey] = useState<string | null>(null);
  const { t } = useTranslation();

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setBodyWidth(event.nativeEvent.layout.width);
      onBodyHeightChange?.(file, event.nativeEvent.layout.height);
    },
    [file, onBodyHeightChange],
  );

  const availableWidth = bodyWidth > 0 ? bodyWidth : scrollViewWidth;
  const linesContainerRowStyle = useMemo(
    () => [
      styles.linesContainer,
      availableWidth > 0 && inlineUnistylesStyle({ minWidth: availableWidth }),
    ],
    [availableWidth],
  );

  return (
    <View style={FILE_SECTION_BODY_STYLE} onLayout={handleLayout} testID={testID}>
      {(() => {
        const isBinary = file.status === "binary";
        // Treat an over-cap "ok" file exactly like a server-flagged too_large one.
        const isTooLarge = file.status === "too_large" || isDiffBodyTooLargeToRender(file);
        if (isBinary || isTooLarge) {
          return (
            <View style={styles.statusMessageContainer}>
              <Text style={styles.statusMessageText}>
                {isBinary ? t("workspace.git.diff.binaryFile") : t("workspace.git.diff.tooLarge")}
              </Text>
            </View>
          );
        }

        let maxLineNo = 0;
        for (const hunk of file.hunks) {
          maxLineNo = Math.max(
            maxLineNo,
            hunk.oldStart + hunk.oldCount,
            hunk.newStart + hunk.newCount,
          );
        }
        const gutterWidth = lineNumberGutterWidth(maxLineNo, codeFontSize);

        if (layout === "split") {
          const rows = buildSplitDiffRows(file);
          return (
            <View style={DIFF_CONTENT_SPLIT_ROW_STYLE} dataSet={CODE_SURFACE_DATASET}>
              <SplitDiffColumn
                rows={rows}
                side="left"
                gutterWidth={gutterWidth}
                wrapLines={wrapLines}
                textMetricsStyle={textMetricsStyle}
                reviewActions={reviewActions}
                onLineContextMenu={onLineContextMenu}
              />
              <SplitDiffColumn
                rows={rows}
                side="right"
                gutterWidth={gutterWidth}
                wrapLines={wrapLines}
                textMetricsStyle={textMetricsStyle}
                reviewActions={reviewActions}
                onLineContextMenu={onLineContextMenu}
                showDivider
              />
            </View>
          );
        }

        const computedLines = buildUnifiedDiffLines(file);

        if (wrapLines) {
          return (
            <View style={styles.diffContent} dataSet={CODE_SURFACE_DATASET}>
              <View style={styles.linesContainer}>
                {computedLines.map(({ line, lineNumber, key, reviewTarget }, index) => (
                  <View key={key} testID={`diff-wrapped-row-${index}`}>
                    <DiffLineView
                      line={line}
                      lineNumber={lineNumber}
                      gutterWidth={gutterWidth}
                      wrapLines={wrapLines}
                      textMetricsStyle={textMetricsStyle}
                      reviewTarget={reviewTarget}
                      reviewActions={reviewActions}
                      onLineContextMenu={onLineContextMenu}
                    />
                    <InlineReviewRow
                      reviewTarget={reviewTarget}
                      reviewActions={reviewActions}
                      gutterWidth={gutterWidth}
                    />
                  </View>
                ))}
              </View>
            </View>
          );
        }

        const textViewportWidth =
          scrollViewWidth > 0 ? scrollViewWidth : Math.max(0, bodyWidth - gutterWidth);
        return (
          <View style={DIFF_CONTENT_ROW_STYLE} dataSet={CODE_SURFACE_DATASET}>
            <View style={styles.gutterColumn}>
              {computedLines.map(({ line, lineNumber, key, reviewTarget }, index) => (
                <View key={key} testID={`diff-gutter-row-${index}`}>
                  <DiffGutterCell
                    lineNumber={lineNumber}
                    type={line.type}
                    gutterWidth={gutterWidth}
                    textMetricsStyle={textMetricsStyle}
                    reviewTarget={reviewTarget}
                    reviewActions={reviewActions}
                    isLineHovered={
                      reviewTarget?.key !== undefined && hoveredReviewTargetKey === reviewTarget.key
                    }
                    textTestID={`diff-gutter-text-${index}`}
                    actionTestID={`diff-gutter-action-${index}`}
                  />
                  <InlineReviewGutterSpacer
                    reviewTarget={reviewTarget}
                    reviewActions={reviewActions}
                    gutterWidth={gutterWidth}
                  />
                </View>
              ))}
            </View>
            <DiffScroll
              scrollViewWidth={scrollViewWidth}
              onScrollViewWidthChange={setScrollViewWidth}
              style={styles.splitColumnScroll}
              contentContainerStyle={styles.diffContentInner}
            >
              <View style={linesContainerRowStyle}>
                {computedLines.map(({ line, key, reviewTarget }, index) => (
                  <View key={key} testID={`diff-code-row-${index}`}>
                    <DiffTextLine
                      line={line}
                      wrapLines={false}
                      textMetricsStyle={textMetricsStyle}
                      reviewTarget={reviewTarget}
                      reviewActions={reviewActions}
                      hoverTargetKey={reviewTarget?.key ?? null}
                      onHoverTargetChange={setHoveredReviewTargetKey}
                      onLineContextMenu={onLineContextMenu}
                      textTestID={`diff-code-text-${index}`}
                    />
                    <InlineReviewThreadContent
                      reviewTarget={reviewTarget}
                      reviewActions={reviewActions}
                      viewportWidth={textViewportWidth}
                      pinToViewport
                    />
                  </View>
                ))}
              </View>
            </DiffScroll>
          </View>
        );
      })()}
    </View>
  );
}

interface GitDiffPaneProps {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  enabled?: boolean;
  onOpenFile?: (filePath: string, options?: { edit?: boolean; lineStart?: number }) => void;
}

type PressableStyleFn = (
  state: PressableStateCallbackType & { hovered?: boolean; open?: boolean },
) => StyleProp<ViewStyle>;

const foregroundMutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveIconColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const accentForegroundIconColorMapping = (theme: Theme) => ({
  color: theme.colors.accentForeground,
});

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedAlignJustify = withUnistyles(AlignJustify);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedPilcrow = withUnistyles(Pilcrow);
const ThemedWrapText = withUnistyles(WrapText);
const ThemedListChevronsDownUp = withUnistyles(ListChevronsDownUp);
const ThemedListChevronsUpDown = withUnistyles(ListChevronsUpDown);
const ThemedFolderTree = withUnistyles(FolderTree);
const ThemedList = withUnistyles(List);
const ThemedGitCommitHorizontal = withUnistyles(GitCommitHorizontal);
const ThemedDownload = withUnistyles(Download);
const ThemedUpload = withUnistyles(Upload);
const ThemedArrowDownUp = withUnistyles(ArrowDownUp);
const ThemedGitHostingIcon = withUnistyles(GitHostingIcon);
const ThemedGitMerge = withUnistyles(GitMerge);
const ThemedRefreshCcw = withUnistyles(RefreshCcw);
const ThemedArchive = withUnistyles(Archive);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedCheck = withUnistyles(Check);

const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedCopy = withUnistyles(Copy);
const ThemedPaperclip = withUnistyles(Paperclip);
const DIFF_CONTEXT_EDIT_ICON = (
  <ThemedSquarePen size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_CONTEXT_COPY_PATH_ICON = (
  <ThemedCopy size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_CONTEXT_FIND_IN_FILES_ICON = (
  <ThemedFolderTree size={14} uniProps={foregroundMutedIconColorMapping} />
);
const ThemedHistory = withUnistyles(History);
const DIFF_CONTEXT_HISTORY_ICON = (
  <ThemedHistory size={14} uniProps={foregroundMutedIconColorMapping} />
);

/**
 * "Git history" for the right-clicked file.
 *
 * Its own component so the capability check, the workspace check, and the
 * handler live together instead of adding three more branches to GitDiffPane,
 * which is already at the complexity ceiling. Every row in this pane is a
 * tracked path in the repo, so unlike the Files explorer there is no
 * is-this-a-repo test to make — if the host can answer, the question applies.
 */
function DiffContextHistoryMenuItem({
  serverId,
  workspaceId,
  request,
}: {
  serverId: string;
  workspaceId?: string | null;
  request: DiffContextMenuRequest | null;
}) {
  const { t } = useTranslation();
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutGitFileHistory === true,
  );
  const handleSelect = useCallback(() => {
    if (request && workspaceId) {
      openFileHistoryTab({ serverId, workspaceId, path: request.path });
    }
  }, [request, serverId, workspaceId]);

  if (!supported || !workspaceId || !request) {
    return null;
  }
  return (
    <ContextMenuItem
      leading={DIFF_CONTEXT_HISTORY_ICON}
      onSelect={handleSelect}
      testID="changes-context-menu-git-history"
    >
      {t("gitFileHistory.open")}
    </ContextMenuItem>
  );
}
const DIFF_CONTEXT_ADD_TO_CONTEXT_ICON = (
  <ThemedPaperclip size={14} uniProps={foregroundMutedIconColorMapping} />
);
const ThemedUndo2 = withUnistyles(Undo2);
const DIFF_CONTEXT_ROLLBACK_ICON = <ThemedUndo2 size={14} uniProps={destructiveIconColorMapping} />;
const ThemedTrash2 = withUnistyles(Trash2);

const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

type DiffFlatItemLayoutGetter = NonNullable<FlatListProps<DiffFlatItem>["getItemLayout"]>;

function getUnifiedDiffLineCount(file: ParsedDiffFile): number {
  let lineCount = 0;
  for (const hunk of file.hunks) {
    lineCount += hunk.lines.length;
  }
  return lineCount;
}

function getDiffContentLength(file: ParsedDiffFile): number {
  let contentLength = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      contentLength += line.content.length;
    }
  }
  return contentLength;
}

function computeEmptyMessage(
  hideWhitespace: boolean,
  diffMode: "uncommitted" | "base",
  baseRefLabel: string,
  labels: {
    hiddenWhitespace: string;
    uncommitted: string;
    againstBase: (baseRefLabel: string) => string;
  },
): string {
  if (hideWhitespace) {
    return labels.hiddenWhitespace;
  }
  if (diffMode === "uncommitted") {
    return labels.uncommitted;
  }
  return labels.againstBase(baseRefLabel);
}

interface DiffBodyContentProps {
  isStatusLoading: boolean;
  statusErrorMessage: string | null;
  notGit: boolean;
  isDiffLoading: boolean;
  diffErrorMessage: string | null;
  hasChanges: boolean;
  emptyMessage: string;
  flatItems: DiffFlatItem[];
  stickyHeaderIndices: number[];
  renderFlatItem: ({ item }: { item: DiffFlatItem }) => ReactElement;
  flatKeyExtractor: (item: DiffFlatItem) => string;
  getFlatItemLayout: DiffFlatItemLayoutGetter;
  flatExtraData: unknown;
  diffListRef: RefObject<FlatList<DiffFlatItem> | null>;
  handleDiffListLayout: (event: LayoutChangeEvent) => void;
  handleDiffListScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSizeChange: (width: number, height: number) => void;
  showWebScrollbar: boolean;
  checkingRepositoryLabel: string;
  notRepositoryLabel: string;
}

function DiffBodyContent({
  isStatusLoading,
  statusErrorMessage,
  notGit,
  isDiffLoading,
  diffErrorMessage,
  hasChanges,
  emptyMessage,
  flatItems,
  stickyHeaderIndices,
  renderFlatItem,
  flatKeyExtractor,
  getFlatItemLayout,
  flatExtraData,
  diffListRef,
  handleDiffListLayout,
  handleDiffListScroll,
  onContentSizeChange,
  showWebScrollbar,
  checkingRepositoryLabel,
  notRepositoryLabel,
}: DiffBodyContentProps) {
  if (isStatusLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ThemedActivityIndicator size="large" uniProps={foregroundMutedIconColorMapping} />
        <Text style={styles.loadingText}>{checkingRepositoryLabel}</Text>
      </View>
    );
  }
  if (statusErrorMessage) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{statusErrorMessage}</Text>
      </View>
    );
  }
  if (notGit) {
    return (
      <View style={styles.emptyContainer} testID="changes-not-git">
        <Text style={styles.emptyText}>{notRepositoryLabel}</Text>
      </View>
    );
  }
  if (isDiffLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ThemedActivityIndicator size="large" uniProps={foregroundMutedIconColorMapping} />
      </View>
    );
  }
  if (diffErrorMessage) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{diffErrorMessage}</Text>
      </View>
    );
  }
  if (!hasChanges) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{emptyMessage}</Text>
      </View>
    );
  }
  return (
    <FlatList
      ref={diffListRef}
      data={flatItems}
      renderItem={renderFlatItem}
      keyExtractor={flatKeyExtractor}
      getItemLayout={getFlatItemLayout}
      stickyHeaderIndices={stickyHeaderIndices}
      extraData={flatExtraData}
      style={styles.scrollView}
      contentContainerStyle={styles.contentContainer}
      testID="git-diff-scroll"
      onLayout={handleDiffListLayout}
      onScroll={handleDiffListScroll}
      onContentSizeChange={onContentSizeChange}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={!showWebScrollbar}
      // Mixed-height rows (header + potentially very large body) are prone to clipping artifacts.
      // Keep a larger render window and disable clipping to avoid bodies disappearing mid-scroll.
      removeClippedSubviews={false}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={10}
    />
  );
}

interface DeriveStatusStateInputs {
  status: ReturnType<typeof useCheckoutStatusQuery>["status"];
  isStatusLoading: boolean;
  isStatusError: boolean;
  statusError: unknown;
}

interface DerivedStatusState {
  gitStatus: NonNullable<ReturnType<typeof useCheckoutStatusQuery>["status"]> | null;
  isGit: boolean;
  notGit: boolean;
  statusErrorMessage: string | null;
  baseRef: string | undefined;
  hasUncommittedChanges: boolean;
  actionsDisabled: boolean;
  currentBranchName: string | null;
}

function deriveStatusState({
  status,
  isStatusLoading,
  isStatusError,
  statusError,
}: DeriveStatusStateInputs): DerivedStatusState {
  const gitStatus = status && status.isGit ? status : null;
  const isGit = Boolean(gitStatus);
  const notGit = status !== null && !status.isGit && !status.error;
  const statusErrorMessage =
    status?.error?.message ??
    (isStatusError && statusError instanceof Error ? statusError.message : null);
  const baseRef = gitStatus?.baseRef ?? undefined;
  const hasUncommittedChanges = Boolean(gitStatus?.isDirty);
  const actionsDisabled = !isGit || Boolean(status?.error) || isStatusLoading;
  const currentBranchName =
    gitStatus?.currentBranch && gitStatus.currentBranch !== "HEAD" ? gitStatus.currentBranch : null;
  return {
    gitStatus,
    isGit,
    notGit,
    statusErrorMessage,
    baseRef,
    hasUncommittedChanges,
    actionsDisabled,
    currentBranchName,
  };
}

function computeBaseRefLabel(baseRef: string | undefined, fallbackLabel: string): string {
  if (!baseRef) return fallbackLabel;
  const trimmed = baseRef.replace(/^refs\/(heads|remotes)\//, "").trim();
  return trimmed.startsWith("origin/") ? trimmed.slice("origin/".length) : trimmed;
}

function computeCommittedDiffDescription(
  branchLabel: string,
  baseRefLabel: string,
): string | undefined {
  if (!branchLabel || !baseRefLabel) {
    return undefined;
  }
  return branchLabel === baseRefLabel ? undefined : `${branchLabel} -> ${baseRefLabel}`;
}

function computePrErrorMessage(
  githubFeaturesEnabled: boolean,
  prPayloadError: { message?: string } | null | undefined,
): string | null {
  if (!githubFeaturesEnabled) return null;
  return prPayloadError?.message ?? null;
}

function buildDiffModeTriggerStyle(): PressableStyleFn {
  return ({ hovered, pressed, open }) => [
    styles.diffModeTrigger,
    (Boolean(hovered) || pressed || Boolean(open)) && styles.diffModeTriggerHovered,
  ];
}

function shouldEnableCheckoutDiff(input: { paneEnabled: boolean; isGit: boolean }): boolean {
  return input.paneEnabled && input.isGit;
}

/** Attachment dedupe id: the path, or `${path}:${lineStart}` for a diff line. */
function buildDiffContextAttachmentId(request: { path: string; lineStart?: number }): string {
  return request.lineStart != null ? `${request.path}:${request.lineStart}` : request.path;
}

interface DiffContextAttachmentToggle {
  isInContext: boolean;
  label: string;
  onToggle: () => void;
}

interface DiffRollbackActions {
  /** The host supports rollback and the diff is in uncommitted mode. */
  canRollbackFile: boolean;
  /** Multiple files are checkbox-selected, so a bulk rollback is offered. */
  canRollbackSelection: boolean;
  selectionCount: number;
  onRollbackFile: () => void;
  onRollbackSelected: () => void;
}

/**
 * "Rollback file" / "Rollback N files" for the Changes context menu. Rollback
 * discards uncommitted working-tree changes via git, so it only applies in
 * uncommitted mode against a rollback-capable host. The single action targets
 * the right-clicked file; the bulk action targets the commit-checkbox selection.
 * Each is gated behind a destructive confirmation dialog.
 */
function useDiffRollbackActions({
  serverId,
  cwd,
  diffMode,
  contextMenuPath,
  selectedPaths,
  commitSelectionEnabled,
}: {
  serverId: string;
  cwd: string;
  diffMode: "uncommitted" | "base";
  contextMenuPath: string | null;
  selectedPaths: string[];
  commitSelectionEnabled: boolean;
}): DiffRollbackActions {
  const { t } = useTranslation();
  const toast = useToast();
  const rollbackSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutGitRollback === true,
  );
  const rollbackFiles = useCheckoutGitActionsStore((s) => s.rollbackPaths);

  const runRollback = useCallback(
    async (paths: string[], confirm: ConfirmDialogInput) => {
      if (paths.length === 0) {
        return;
      }
      const confirmed = await confirmDialog(confirm);
      if (!confirmed) {
        return;
      }
      const attempt = async (allowWithRunningAgents: boolean): Promise<void> => {
        try {
          await rollbackFiles({
            serverId,
            cwd,
            paths,
            ...(allowWithRunningAgents ? { allowWithRunningAgents: true } : {}),
          });
        } catch (error) {
          if (error instanceof CheckoutGitRollbackFailedError) {
            if (error.rollbackError.kind === "agents_running") {
              const agents = error.rollbackError.agents
                .map((agent) => agent.title?.trim() || t("workspace.git.rollback.unnamedAgent"))
                .join(", ");
              const overrideConfirmed = await confirmDialog({
                title: t("workspace.git.rollback.agentsRunningTitle"),
                message: t("workspace.git.rollback.agentsRunningMessage", { agents }),
                confirmLabel: t("workspace.git.rollback.agentsRunningConfirm"),
                destructive: true,
              });
              if (overrideConfirmed) {
                await attempt(true);
              }
              return;
            }
            const message =
              error.rollbackError.kind === "git_failed"
                ? error.rollbackError.detail
                : t("workspace.git.rollback.failed");
            toast.error(message);
            return;
          }
          toast.error(error instanceof Error ? error.message : t("workspace.git.rollback.failed"));
        }
      };
      await attempt(false);
    },
    [cwd, rollbackFiles, serverId, t, toast],
  );

  const onRollbackFile = useCallback(() => {
    if (!contextMenuPath) {
      return;
    }
    const fileName = contextMenuPath.split("/").pop() ?? contextMenuPath;
    void runRollback([contextMenuPath], {
      title: t("workspace.git.rollback.confirmTitleSingle"),
      message: t("workspace.git.rollback.confirmMessageSingle", { fileName }),
      confirmLabel: t("workspace.git.rollback.confirmButton"),
      destructive: true,
    });
  }, [contextMenuPath, runRollback, t]);

  const onRollbackSelected = useCallback(() => {
    const count = selectedPaths.length;
    void runRollback(selectedPaths, {
      title: t("workspace.git.rollback.confirmTitleMultiple", { count }),
      message: t("workspace.git.rollback.confirmMessageMultiple", { count }),
      confirmLabel: t("workspace.git.rollback.confirmButton"),
      destructive: true,
    });
  }, [runRollback, selectedPaths, t]);

  const canRollbackFile = rollbackSupported && diffMode === "uncommitted";
  const selectionCount = commitSelectionEnabled ? selectedPaths.length : 0;
  const canRollbackSelection = canRollbackFile && selectionCount > 1;

  return {
    canRollbackFile,
    canRollbackSelection,
    selectionCount,
    onRollbackFile,
    onRollbackSelected,
  };
}

/**
 * "Add to chat" for the Changes context menu, mirroring the file explorer's
 * and project search's: the file (or a specific diff line) lands in the
 * workspace-scoped attachment store as a composer pill. Returns null while no
 * agent tab is the focused pane, so the attachment has a visible destination.
 */
function useDiffContextAttachmentToggle({
  serverId,
  scopeKey,
  request,
}: {
  serverId: string;
  scopeKey: string;
  request: DiffContextMenuRequest | null;
}): DiffContextAttachmentToggle | null {
  const { t } = useTranslation();
  const focusedAgentId = useSessionStore(
    (state) => state.sessions[serverId]?.focusedAgentId ?? null,
  );
  const workspaceAttachments = useWorkspaceAttachments(scopeKey);
  const contextAttachmentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const attachment of workspaceAttachments) {
      if (attachment.kind === "file_context") {
        ids.add(attachment.id);
      }
    }
    return ids;
  }, [workspaceAttachments]);

  const onToggle = useCallback(() => {
    if (!request) {
      return;
    }
    const contextId = buildDiffContextAttachmentId(request);
    const { attachmentsByScope, setWorkspaceAttachments, addWorkspaceAttachment } =
      useWorkspaceAttachmentsStore.getState();
    const current = attachmentsByScope[scopeKey] ?? [];
    const remaining = current.filter(
      (attachment) => !(attachment.kind === "file_context" && attachment.id === contextId),
    );
    if (remaining.length !== current.length) {
      setWorkspaceAttachments({ scopeKey, attachments: remaining });
      return;
    }
    addWorkspaceAttachment({
      scopeKey,
      attachment: {
        kind: "file_context",
        id: contextId,
        path: request.path,
        lineStart: request.lineStart,
      },
    });
  }, [request, scopeKey]);

  if (!focusedAgentId || !request) {
    return null;
  }
  const isInContext = contextAttachmentIds.has(buildDiffContextAttachmentId(request));
  let label: string;
  if (request.lineStart != null) {
    label = isInContext
      ? t("projectSearch.removeLineFromContext", { line: request.lineStart })
      : t("projectSearch.addLineToContext", { line: request.lineStart });
  } else {
    label = isInContext
      ? t("workspace.fileExplorer.context.removeFromContext")
      : t("workspace.fileExplorer.context.addToContext");
  }
  return { isInContext, label, onToggle };
}

function DiffRollbackMenuItems({
  rollback,
}: {
  rollback: DiffRollbackActions;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!rollback.canRollbackFile) {
    return null;
  }
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem
        leading={DIFF_CONTEXT_ROLLBACK_ICON}
        destructive
        onSelect={rollback.onRollbackFile}
        testID="changes-context-menu-rollback-file"
      >
        {t("workspace.git.rollback.fileAction")}
      </ContextMenuItem>
      {rollback.canRollbackSelection ? (
        <ContextMenuItem
          leading={DIFF_CONTEXT_ROLLBACK_ICON}
          destructive
          onSelect={rollback.onRollbackSelected}
          testID="changes-context-menu-rollback-selected"
        >
          {t("workspace.git.rollback.filesAction", { count: rollback.selectionCount })}
        </ContextMenuItem>
      ) : null}
    </>
  );
}

function DiffContextToggleMenuItem({ toggle }: { toggle: DiffContextAttachmentToggle | null }) {
  if (!toggle) {
    return null;
  }
  return (
    <ContextMenuItem
      leading={DIFF_CONTEXT_ADD_TO_CONTEXT_ICON}
      onSelect={toggle.onToggle}
      testID={
        toggle.isInContext
          ? "changes-context-menu-remove-from-context"
          : "changes-context-menu-add-to-context"
      }
    >
      {toggle.label}
    </ContextMenuItem>
  );
}

interface ChangesCommitSectionProps {
  serverId: string;
  cwd: string;
  workspaceId: string | null | undefined;
  selectedPaths: string[];
  totalFiles: number;
  commitSupported: boolean;
  logSupported: boolean;
  // Visibility inputs the section resolves itself (keeps the parent's render
  // flat): the form only exists for a git checkout showing uncommitted changes.
  isGit: boolean;
  diffMode: "uncommitted" | "base";
  hasChanges: boolean;
  onToggleSelectAll: () => void;
  onCommitted: () => void;
}

interface CommitErrorDescription {
  title: string;
  detail: string | null;
}

function describeCommitError(
  error: CheckoutGitCommitError,
  t: ReturnType<typeof useTranslation>["t"],
): CommitErrorDescription {
  switch (error.kind) {
    case "identity_missing":
      return { title: t("workspace.git.commit.errorIdentity"), detail: null };
    case "hook_failed":
      return { title: t("workspace.git.commit.errorHook"), detail: error.output.trim() || null };
    case "signing_failed":
      return { title: t("workspace.git.commit.errorSigning"), detail: error.detail.trim() || null };
    case "nothing_to_commit":
      return { title: t("workspace.git.commit.errorNothingToCommit"), detail: null };
    case "git_failed":
      return {
        title: t("workspace.git.commit.errorGitFailed"),
        detail: error.detail.trim() || null,
      };
    case "agents_running":
      // Surfaces as a confirm dialog before retry, never as an inline error.
      return { title: t("workspace.git.commit.errorGitFailed"), detail: null };
  }
}

function CommitLogButton({
  serverId,
  workspaceId,
  enabled,
}: {
  serverId: string;
  workspaceId: string | null | undefined;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  // Doubled on mobile (14 -> 28); unchanged (14) on desktop.
  const logIconSize = useIconSize(2).sm;
  const handleOpenLog = useCallback(() => {
    if (workspaceId) {
      openGitLogTab({ serverId, workspaceId, operation: "commit" });
    }
  }, [serverId, workspaceId]);

  if (!enabled || !workspaceId) {
    return null;
  }

  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={SquareTerminal}
          iconSize={logIconSize}
          onPress={handleOpenLog}
          accessibilityLabel={t("workspace.git.commit.viewLog")}
          testID="changes-commit-log-button"
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="end" offset={6}>
        <Text style={styles.tooltipText}>{t("workspace.git.commit.viewLog")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function ChangesCommitSection({
  serverId,
  cwd,
  workspaceId,
  selectedPaths,
  totalFiles,
  commitSupported,
  logSupported,
  isGit,
  diffMode,
  hasChanges,
  onToggleSelectAll,
  onCommitted,
}: ChangesCommitSectionProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [commitError, setCommitError] = useState<CheckoutGitCommitError | null>(null);
  const commitPaths = useCheckoutGitActionsStore((s) => s.commitPaths);
  const isCommitting =
    useCheckoutGitActionsStore((s) => s.getStatus({ serverId, cwd, actionId: "commit" })) ===
    "pending";

  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const inputStyle = useMemo(
    () => [styles.commitInput, isFocused && styles.commitInputFocused],
    [isFocused],
  );

  const handleCommit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || selectedPaths.length === 0 || isCommitting) {
      return;
    }
    setCommitError(null);
    const attempt = async (allowWithRunningAgents: boolean): Promise<void> => {
      try {
        await commitPaths({
          serverId,
          cwd,
          message: trimmed,
          paths: selectedPaths,
          ...(allowWithRunningAgents ? { allowWithRunningAgents: true } : {}),
        });
        setMessage("");
        onCommitted();
      } catch (error) {
        if (error instanceof CheckoutGitCommitFailedError) {
          if (error.commitError.kind === "agents_running") {
            const agents = error.commitError.agents
              .map((agent) => agent.title?.trim() || t("workspace.git.commit.unnamedAgent"))
              .join(", ");
            const confirmed = await confirmDialog({
              title: t("workspace.git.commit.agentsRunningTitle"),
              message: t("workspace.git.commit.agentsRunningMessage", { agents }),
              confirmLabel: t("workspace.git.commit.agentsRunningConfirm"),
            });
            if (confirmed) {
              await attempt(true);
            }
            return;
          }
          setCommitError(error.commitError);
          return;
        }
        toast.error(
          error instanceof Error ? error.message : t("workspace.git.commit.errorGitFailed"),
        );
      }
    };
    await attempt(false);
  }, [commitPaths, cwd, isCommitting, message, onCommitted, selectedPaths, serverId, t, toast]);

  const allSelected = totalFiles > 0 && selectedPaths.length === totalFiles;
  const partiallySelected = selectedPaths.length > 0 && !allSelected;
  const selectAllAccessibilityState = useMemo(
    () => ({ checked: partiallySelected ? ("mixed" as const) : allSelected }),
    [allSelected, partiallySelected],
  );

  if (!isGit || diffMode !== "uncommitted" || !hasChanges) {
    return null;
  }

  if (!commitSupported) {
    return (
      <View style={styles.commitSection} testID="changes-commit-section">
        <Text style={styles.commitUnsupportedText}>{t("workspace.git.commit.updateHost")}</Text>
      </View>
    );
  }

  const commitDisabled = message.trim().length === 0 || selectedPaths.length === 0 || isCommitting;
  const errorDescription = commitError ? describeCommitError(commitError, t) : null;

  let selectAllMark: ReactElement | null = null;
  if (partiallySelected) {
    selectAllMark = <View style={styles.fileCheckboxIndeterminateMark} />;
  } else if (allSelected) {
    selectAllMark = <ThemedCheck size={12} uniProps={accentForegroundIconColorMapping} />;
  }

  return (
    <View style={styles.commitSection} testID="changes-commit-section">
      <TextInput
        multiline
        value={message}
        onChangeText={setMessage}
        onFocus={handleFocus}
        onBlur={handleBlur}
        editable={!isCommitting}
        placeholder={t("workspace.git.commit.messagePlaceholder")}
        placeholderTextColor={styles.commitPlaceholderColor.color}
        accessibilityLabel={t("workspace.git.commit.messagePlaceholder")}
        style={inputStyle}
        testID="changes-commit-message"
      />
      <View style={styles.commitActions}>
        <View style={styles.commitSelectionGroup}>
          <Pressable
            style={
              allSelected || partiallySelected ? SELECTED_FILE_CHECKBOX_STYLE : styles.fileCheckbox
            }
            onPress={onToggleSelectAll}
            accessibilityRole="checkbox"
            accessibilityState={selectAllAccessibilityState}
            aria-checked={partiallySelected ? "mixed" : allSelected}
            accessibilityLabel={
              allSelected
                ? t("workspace.git.commit.deselectAllFiles")
                : t("workspace.git.commit.selectAllFiles")
            }
            hitSlop={6}
            testID="changes-commit-select-all"
          >
            {selectAllMark}
          </Pressable>
          <Text style={styles.commitSelectionCount} numberOfLines={1}>
            {t("workspace.git.commit.filesSelected", {
              selected: selectedPaths.length,
              total: totalFiles,
            })}
          </Text>
        </View>
        <View style={styles.commitButtonGroup}>
          <CommitLogButton serverId={serverId} workspaceId={workspaceId} enabled={logSupported} />
          <Button
            size="sm"
            variant="default"
            disabled={commitDisabled}
            onPress={handleCommit}
            testID="changes-commit-button"
          >
            {isCommitting ? t("workspace.git.commit.committing") : t("workspace.git.commit.button")}
          </Button>
        </View>
      </View>
      {errorDescription ? (
        <Text style={styles.commitErrorText} testID="changes-commit-error">
          {errorDescription.title}
        </Text>
      ) : null}
      {errorDescription?.detail ? (
        <Text style={styles.commitErrorDetail} testID="changes-commit-error-detail">
          {errorDescription.detail}
        </Text>
      ) : null}
    </View>
  );
}

const EMPTY_DESELECTED_PATHS: ReadonlySet<string> = new Set<string>();

// The diff body reads the raw code-size setting directly, so it bypasses the
// global compact font patch (apply-appearance bumps theme.fontSize.code +2 on
// compact). Re-apply that +2 on mobile so the diff code matches the rest of the
// compact UI — the file list and commit UI get a matching bump in the stylesheet.
function resolveDiffCodeFontSize(baseCodeFontSize: number, isMobile: boolean): number {
  return isMobile ? baseCodeFontSize + 2 : baseCodeFontSize;
}

export function GitDiffPane({ serverId, workspaceId, cwd, enabled, onOpenFile }: GitDiffPaneProps) {
  const { settings: appSettings } = useAppSettings();
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  // Not gated on form factor: a narrow browser window still draws the platform's
  // dated bar, so compact web needs the themed overlay every bit as much as
  // desktop does. Native is unaffected — the hook no-ops off web.
  const showWebScrollbar = isWeb;
  const canUseSplitLayout = isWeb && !isMobile;
  const { preferences: changesPreferences, updatePreferences: updateChangesPreferences } =
    useChangesPreferences();
  const wrapLines = changesPreferences.wrapLines;
  const viewMode = changesPreferences.viewMode;
  const effectiveLayout = canUseSplitLayout ? changesPreferences.layout : "unified";

  const handleToggleWrapLines = useCallback(() => {
    void updateChangesPreferences({ wrapLines: !wrapLines });
  }, [updateChangesPreferences, wrapLines]);

  const handleToggleHideWhitespace = useCallback(() => {
    void updateChangesPreferences({ hideWhitespace: !changesPreferences.hideWhitespace });
  }, [changesPreferences.hideWhitespace, updateChangesPreferences]);

  const handleToggleLayout = useCallback(() => {
    void updateChangesPreferences({
      layout: changesPreferences.layout === "unified" ? "split" : "unified",
    });
  }, [changesPreferences.layout, updateChangesPreferences]);

  const codeFontSize = resolveDiffCodeFontSize(appSettings.codeFontSize, isMobile);
  const diffBodyLineHeight = Math.round(codeFontSize * 1.5);
  const diffBodyTypographyKey = [appSettings.monoFontFamily, codeFontSize, diffBodyLineHeight].join(
    ":",
  );
  const diffTextMetricsStyle = useMemo<TextStyle>(() => {
    const monoFontFamily = appSettings.monoFontFamily.trim();
    return {
      fontSize: codeFontSize,
      lineHeight: diffBodyLineHeight,
      ...(monoFontFamily ? { fontFamily: monoFontFamily } : null),
    };
  }, [appSettings.monoFontFamily, codeFontSize, diffBodyLineHeight]);
  const diffModeTriggerStyle = useMemo(() => buildDiffModeTriggerStyle(), []);

  const pinnedToolbarItems = changesPreferences.pinnedToolbarItems;
  const handleToggleToolbarPin = useCallback(
    (id: ChangesToolbarItemId) => {
      void updateChangesPreferences({
        pinnedToolbarItems: toggleChangesToolbarItem(changesPreferences.pinnedToolbarItems, id),
      });
    },
    [changesPreferences.pinnedToolbarItems, updateChangesPreferences],
  );
  // Hover reveal for the toolbar strip: tracked on the plain status-row View
  // below (see docs/hover.md). Pinned icons are opacity-gated until the pointer
  // enters the row; always visible on native/compact.
  const [toolbarHovered, setToolbarHovered] = useState(false);
  const handleToolbarPointerEnter = useCallback(() => setToolbarHovered(true), []);
  const handleToolbarPointerLeave = useCallback(() => setToolbarHovered(false), []);

  const toast = useToast();
  const refreshSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutRefresh === true,
  );
  const commitSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutGitCommit === true,
  );
  const gitLogSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutGitLog === true,
  );
  // Commit selection is an ephemeral exclusion set: files default to included,
  // so changes appearing after the user starts selecting stay checked.
  const [deselectedPaths, setDeselectedPaths] =
    useState<ReadonlySet<string>>(EMPTY_DESELECTED_PATHS);
  const handleToggleFileSelected = useCallback((path: string) => {
    setDeselectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);
  const clearCommitSelection = useCallback(() => {
    setDeselectedPaths(EMPTY_DESELECTED_PATHS);
  }, []);
  const runRefresh = useCheckoutGitActionsStore((s) => s.refresh);
  const isRefreshing =
    useCheckoutGitActionsStore((s) => s.getStatus({ serverId, cwd, actionId: "refresh" })) ===
    "pending";

  const handleRefresh = useCallback(() => {
    if (isRefreshing) {
      return;
    }
    void runRefresh({ serverId, cwd }).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("workspace.git.diff.failedRefresh"));
    });
  }, [cwd, isRefreshing, runRefresh, serverId, t, toast]);

  const {
    status,
    isLoading: isStatusLoading,
    isError: isStatusError,
    error: statusError,
  } = useCheckoutStatusQuery({ serverId, cwd });
  const statusState = deriveStatusState({ status, isStatusLoading, isStatusError, statusError });
  const { isGit, notGit, statusErrorMessage, baseRef, hasUncommittedChanges, currentBranchName } =
    statusState;

  const reviewDraftScopeKey = useMemo(
    () =>
      buildReviewDraftScopeKey({
        serverId,
        workspaceId,
        cwd,
        baseRef,
        ignoreWhitespace: changesPreferences.hideWhitespace,
      }),
    [baseRef, changesPreferences.hideWhitespace, cwd, serverId, workspaceId],
  );
  const diffMode = useResolvedDiffMode({
    scopeKey: reviewDraftScopeKey,
    hasUncommittedChanges,
  });
  const setDiffModeOverride = useSetDiffModeOverride();

  const {
    files,
    payloadError: diffPayloadError,
    isLoading: isDiffLoading,
  } = useCheckoutDiffQuery({
    serverId,
    cwd,
    mode: diffMode,
    baseRef,
    ignoreWhitespace: changesPreferences.hideWhitespace,
    enabled: shouldEnableCheckoutDiff({ paneEnabled: enabled !== false, isGit }),
  });
  const commitSelectionEnabled = commitSupported && diffMode === "uncommitted";
  const selectedPaths = useMemo(
    () => files.filter((file) => !deselectedPaths.has(file.path)).map((file) => file.path),
    [deselectedPaths, files],
  );
  const handleToggleSelectAll = useCallback(() => {
    setDeselectedPaths((prev) => {
      const allSelected = files.every((file) => !prev.has(file.path));
      return allSelected ? new Set(files.map((file) => file.path)) : EMPTY_DESELECTED_PATHS;
    });
  }, [files]);

  const reviewDraftKey = useMemo(
    () =>
      buildReviewDraftKey({
        serverId,
        workspaceId,
        cwd,
        mode: diffMode,
        baseRef,
        // Draft comments anchor to this branch's diff; switching branches moves
        // the pane to that branch's own (possibly empty) comment bucket.
        branch: currentBranchName,
        ignoreWhitespace: changesPreferences.hideWhitespace,
      }),
    [
      baseRef,
      changesPreferences.hideWhitespace,
      currentBranchName,
      cwd,
      diffMode,
      serverId,
      workspaceId,
    ],
  );

  const handleSelectUncommitted = useCallback(() => {
    setDiffModeOverride({
      scopeKey: reviewDraftScopeKey,
      override: { serverId, cwd, mode: "uncommitted", isDirtyAtSelection: hasUncommittedChanges },
    });
  }, [cwd, hasUncommittedChanges, reviewDraftScopeKey, serverId, setDiffModeOverride]);

  const handleSelectBase = useCallback(() => {
    setDiffModeOverride({
      scopeKey: reviewDraftScopeKey,
      override: { serverId, cwd, mode: "base", isDirtyAtSelection: hasUncommittedChanges },
    });
  }, [cwd, hasUncommittedChanges, reviewDraftScopeKey, serverId, setDiffModeOverride]);

  const reviewActions = useInlineReviewController({
    reviewDraftKey,
  });
  const reviewCommentCount = useReviewCommentCount(reviewDraftKey);
  const clearReviewDraft = useClearReviewDraft();
  const handleRemoveAllComments = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title:
          reviewCommentCount === 1
            ? t("review.removeAll.confirmTitleSingle")
            : t("review.removeAll.confirmTitleMultiple", { count: reviewCommentCount }),
        message: t("review.removeAll.confirmMessage"),
        confirmLabel: t("review.removeAll.confirmButton"),
        destructive: true,
      });
      if (confirmed) {
        // Clearing the draft bucket also empties the review attachment snapshot,
        // so the composer's review pill disappears via the sync effect below.
        clearReviewDraft({ key: reviewDraftKey });
      }
    })();
  }, [clearReviewDraft, reviewCommentCount, reviewDraftKey, t]);
  const reviewAttachment = useReviewAttachmentSnapshot({
    key: reviewDraftKey,
    diffFiles: files,
    cwd,
    mode: diffMode,
    baseRef,
  });
  const workspaceAttachmentScopeKey = useMemo(
    () => buildWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd }),
    [cwd, serverId, workspaceId],
  );

  // This pane owns only the review slice of the attachment scope: file-context
  // pills added from this pane's context menu (or the Files/Search panes) must
  // survive review-snapshot updates and this pane unmounting.
  useEffect(() => {
    const syncReviewAttachment = (attachment: typeof reviewAttachment) => {
      const store = useWorkspaceAttachmentsStore.getState();
      const current = store.attachmentsByScope[workspaceAttachmentScopeKey] ?? [];
      const others = current.filter((existing) => existing.kind !== "review");
      store.setWorkspaceAttachments({
        scopeKey: workspaceAttachmentScopeKey,
        attachments: attachment ? [...others, attachment] : others,
      });
    };
    syncReviewAttachment(reviewAttachment);
    return () => syncReviewAttachment(null);
  }, [reviewAttachment, workspaceAttachmentScopeKey]);
  const { githubFeaturesEnabled, payloadError: prPayloadError } = useCheckoutPrStatusQuery({
    serverId,
    cwd,
    enabled: isGit,
  });
  const normalizedWorkspaceRoot = useMemo(() => cwd.trim(), [cwd]);
  const workspaceStateKey = useMemo(
    () =>
      buildWorkspaceExplorerStateKey({
        workspaceId,
        workspaceRoot: normalizedWorkspaceRoot,
      }),
    [normalizedWorkspaceRoot, workspaceId],
  );
  const expandedPathsArray = usePanelStore((state) =>
    workspaceStateKey ? state.diffExpandedPathsByWorkspace[workspaceStateKey] : undefined,
  );
  const setDiffExpandedPathsForWorkspace = usePanelStore(
    (state) => state.setDiffExpandedPathsForWorkspace,
  );
  const expandedPaths = useMemo(() => new Set(expandedPathsArray ?? []), [expandedPathsArray]);
  // The Changes view groups files into a directory tree on every form factor,
  // consistent with the Files explorer (which is also a tree on mobile).
  const collapsedFoldersArray = usePanelStore((state) =>
    workspaceStateKey ? state.diffCollapsedFoldersByWorkspace[workspaceStateKey] : undefined,
  );
  const setDiffCollapsedFoldersForWorkspace = usePanelStore(
    (state) => state.setDiffCollapsedFoldersForWorkspace,
  );
  // Build the directory tree once per files-change; collapse/expand toggles only
  // re-flatten it (they don't change tree shape).
  const compressedTree = useMemo(() => compressSingleChildChains(buildDiffTree(files)), [files]);
  // Every directory path currently in the tree — used by "collapse all folders" and to
  // filter stale collapse state.
  const allFolderPaths = useMemo(() => collectDirPaths(compressedTree), [compressedTree]);
  const allFolderPathSet = useMemo(() => new Set(allFolderPaths), [allFolderPaths]);
  // Effective collapsed set: intersect the persisted paths with the folders actually
  // present, purely at render (no store-syncing effect). A folder that left the diff and
  // reappears defaults to expanded; toggles write back this pruned set, so the stored
  // array stays bounded. (empty = all folders expanded, the default)
  const collapsedFolders = useMemo(
    () => new Set((collapsedFoldersArray ?? []).filter((path) => allFolderPathSet.has(path))),
    [collapsedFoldersArray, allFolderPathSet],
  );
  const diffListRef = useRef<FlatList<DiffFlatItem>>(null);
  const handleToggleViewMode = useCallback(() => {
    const nextViewMode = viewMode === "flat" ? "tree" : "flat";
    if (nextViewMode === "tree") {
      diffListRef.current?.scrollToOffset({ offset: 0, animated: false });
      if (workspaceStateKey) {
        setDiffCollapsedFoldersForWorkspace(workspaceStateKey, []);
      }
    }
    void updateChangesPreferences({ viewMode: nextViewMode });
  }, [setDiffCollapsedFoldersForWorkspace, updateChangesPreferences, viewMode, workspaceStateKey]);
  const scrollbar = useWebScrollViewScrollbar(diffListRef, {
    enabled: showWebScrollbar,
  });
  const diffListScrollOffsetRef = useRef(0);
  const diffListViewportHeightRef = useRef(0);
  const headerHeightByPathRef = useRef<Record<string, number>>({});
  const bodyHeightByKeyRef = useRef<Record<string, number>>({});
  // Folder rows are a distinct kind; keep their height out of headerHeightByPathRef
  // (Codex item 6) so file/folder heights can't collide by path.
  const folderRowHeightRef = useRef<number>(0);
  const defaultHeaderHeightRef = useRef<number>(44);
  const [heightVersion, setHeightVersion] = useState(0);
  const diffBodyChromeHeight = BORDER_WIDTH[1] * 2;
  const statusBodyHeightEstimate = diffBodyChromeHeight + SPACING[4] * 2 + diffBodyLineHeight;
  const { flatItems, stickyHeaderIndices } = useMemo(() => {
    const { items, stickyHeaderIndices: stickyIndices } = buildDiffFlatItems({
      files,
      viewMode,
      tree: compressedTree,
      collapsedFolders,
      expandedPaths,
    });
    return { flatItems: items, stickyHeaderIndices: stickyIndices };
  }, [compressedTree, collapsedFolders, expandedPaths, files, viewMode]);

  const getBodyHeightKey = useCallback(
    (file: ParsedDiffFile): string => {
      // Over-cap files render the "too large" placeholder, so key them like the
      // server-flagged statuses (cheap + stable) rather than by line/content.
      let placeholderStatus: "binary" | "too_large" | null = null;
      if (file.status === "binary") {
        placeholderStatus = "binary";
      } else if (file.status === "too_large" || isDiffBodyTooLargeToRender(file)) {
        placeholderStatus = "too_large";
      }
      if (placeholderStatus) {
        return `${effectiveLayout}:${wrapLines ? "wrap" : "scroll"}:${diffBodyTypographyKey}:${file.path}:${placeholderStatus}`;
      }

      return [
        effectiveLayout,
        wrapLines ? "wrap" : "scroll",
        diffBodyTypographyKey,
        file.path,
        file.status ?? "ok",
        file.additions,
        file.deletions,
        file.hunks.length,
        getUnifiedDiffLineCount(file),
        getDiffContentLength(file),
      ].join(":");
    },
    [diffBodyTypographyKey, effectiveLayout, wrapLines],
  );

  const estimateBodyHeight = useCallback(
    (file: ParsedDiffFile): number => {
      if (
        file.status === "too_large" ||
        file.status === "binary" ||
        isDiffBodyTooLargeToRender(file)
      ) {
        return statusBodyHeightEstimate;
      }

      const lineCount =
        effectiveLayout === "split"
          ? buildSplitDiffRows(file).length
          : getUnifiedDiffLineCount(file);
      return diffBodyChromeHeight + lineCount * diffBodyLineHeight;
    },
    [diffBodyChromeHeight, diffBodyLineHeight, effectiveLayout, statusBodyHeightEstimate],
  );

  // Single height source of truth for both getItemLayout and the collapse
  // scroll-anchor math. Folder rows use their own measured height (Codex item 6),
  // falling back to the default header height before first measurement.
  const getFlatItemHeight = useCallback(
    (item: DiffFlatItem): number => {
      if (item.type === "folder") {
        return folderRowHeightRef.current || defaultHeaderHeightRef.current;
      }
      if (item.type === "header") {
        return headerHeightByPathRef.current[item.file.path] ?? defaultHeaderHeightRef.current;
      }
      const bodyHeightKey = getBodyHeightKey(item.file);
      return bodyHeightByKeyRef.current[bodyHeightKey] ?? estimateBodyHeight(item.file);
    },
    [estimateBodyHeight, getBodyHeightKey],
  );

  const handleFolderRowHeightChange = useCallback((height: number) => {
    if (!Number.isFinite(height) || height <= 0) {
      return;
    }
    const previousHeight = folderRowHeightRef.current;
    if (previousHeight > 0 && Math.abs(previousHeight - height) <= DIFF_HEIGHT_CHANGE_EPSILON) {
      return;
    }
    folderRowHeightRef.current = height;
    setHeightVersion((version) => version + 1);
  }, []);

  const handleHeaderHeightChange = useCallback((path: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) {
      return;
    }
    const previousHeight = headerHeightByPathRef.current[path];
    if (
      previousHeight !== undefined &&
      Math.abs(previousHeight - height) <= DIFF_HEIGHT_CHANGE_EPSILON
    ) {
      return;
    }
    headerHeightByPathRef.current[path] = height;
    defaultHeaderHeightRef.current = height;
    setHeightVersion((version) => version + 1);
  }, []);

  const handleBodyHeightChange = useCallback(
    (file: ParsedDiffFile, height: number) => {
      if (!Number.isFinite(height) || height < 0) {
        return;
      }
      const heightKey = getBodyHeightKey(file);
      const previousHeight = bodyHeightByKeyRef.current[heightKey];
      if (
        previousHeight !== undefined &&
        Math.abs(previousHeight - height) <= DIFF_HEIGHT_CHANGE_EPSILON
      ) {
        return;
      }
      bodyHeightByKeyRef.current[heightKey] = height;
      setHeightVersion((version) => version + 1);
    },
    [getBodyHeightKey],
  );

  const handleDiffListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      diffListScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
      scrollbar.onScroll(event);
    },
    [scrollbar],
  );

  const handleDiffListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      if (!Number.isFinite(height) || height <= 0) {
        return;
      }
      diffListViewportHeightRef.current = height;
      scrollbar.onLayout(event);
    },
    [scrollbar],
  );

  // Offset of the first item matching `predicate`, walking the SAME flatItems
  // list getFlatItemLayout uses so folder rows are counted (single source of
  // truth — Codex item 5 / finding 2).
  const computeItemOffset = useCallback(
    (predicate: (item: DiffFlatItem) => boolean): number | null => {
      const index = flatItems.findIndex(predicate);
      if (index < 0) {
        return null;
      }
      return sumHeightsBefore(flatItems, index, getFlatItemHeight);
    },
    [flatItems, getFlatItemHeight],
  );

  const computeHeaderOffset = useCallback(
    (path: string): number =>
      computeItemOffset((item) => item.type === "header" && item.file.path === path) ?? 0,
    [computeItemOffset],
  );

  const handleToggleExpanded = useCallback(
    (path: string) => {
      if (!workspaceStateKey) {
        return;
      }
      const isCurrentlyExpanded = expandedPaths.has(path);
      const nextExpanded = !isCurrentlyExpanded;
      const targetOffset = isCurrentlyExpanded ? computeHeaderOffset(path) : null;
      const headerHeight = headerHeightByPathRef.current[path] ?? defaultHeaderHeightRef.current;
      const shouldAnchor =
        isCurrentlyExpanded &&
        targetOffset !== null &&
        shouldAnchorHeaderBeforeCollapse({
          headerOffset: targetOffset,
          headerHeight,
          viewportOffset: diffListScrollOffsetRef.current,
          viewportHeight: diffListViewportHeightRef.current,
        });

      // Anchor to the clicked header before collapsing so visual context is preserved.
      if (shouldAnchor && targetOffset !== null) {
        diffListRef.current?.scrollToOffset({
          offset: targetOffset,
          animated: false,
        });
      }

      const nextPaths = nextExpanded
        ? [...expandedPaths, path]
        : Array.from(expandedPaths).filter((expandedPath) => expandedPath !== path);
      setDiffExpandedPathsForWorkspace(workspaceStateKey, nextPaths);
    },
    [computeHeaderOffset, expandedPaths, setDiffExpandedPathsForWorkspace, workspaceStateKey],
  );

  const handleToggleFolder = useCallback(
    (dirPath: string) => {
      if (!workspaceStateKey) {
        return;
      }
      const isCurrentlyCollapsed = collapsedFolders.has(dirPath);
      // Collapsing hides the subtree below this row; anchor to the folder row
      // first so the viewport doesn't jump to a dead offset (Codex item 5).
      if (!isCurrentlyCollapsed) {
        const targetOffset = computeItemOffset(
          (item) => item.type === "folder" && item.dirPath === dirPath,
        );
        const folderHeight = folderRowHeightRef.current || defaultHeaderHeightRef.current;
        if (
          targetOffset !== null &&
          shouldAnchorHeaderBeforeCollapse({
            headerOffset: targetOffset,
            headerHeight: folderHeight,
            viewportOffset: diffListScrollOffsetRef.current,
            viewportHeight: diffListViewportHeightRef.current,
          })
        ) {
          diffListRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
        }
      }

      const nextCollapsed = isCurrentlyCollapsed
        ? Array.from(collapsedFolders).filter((path) => path !== dirPath)
        : [...collapsedFolders, dirPath];
      setDiffCollapsedFoldersForWorkspace(workspaceStateKey, nextCollapsed);
    },
    [collapsedFolders, computeItemOffset, setDiffCollapsedFoldersForWorkspace, workspaceStateKey],
  );

  const allFileDiffsExpanded = useMemo(() => {
    if (files.length === 0) return false;
    return files.every((file) => expandedPaths.has(file.path));
  }, [expandedPaths, files]);

  const handleToggleExpandAll = useCallback(() => {
    if (!workspaceStateKey) {
      return;
    }
    if (allFileDiffsExpanded) {
      setDiffExpandedPathsForWorkspace(workspaceStateKey, []);
      return;
    }
    // Never expand thousands of bodies at once — that's the crash path. Collapse
    // (the branch above) always stays available.
    if (files.length > MAX_EXPAND_ALL_FILE_COUNT) {
      return;
    }
    setDiffExpandedPathsForWorkspace(
      workspaceStateKey,
      files.map((file) => file.path),
    );
  }, [allFileDiffsExpanded, files, setDiffExpandedPathsForWorkspace, workspaceStateKey]);

  const hasFiles = files.length > 0;
  // The full toolbar catalog in fixed order. Each entry's icon/label reflect
  // the current state (the action it performs), shared verbatim by the pinned
  // strip button and its ▾-menu row. Unavailable options (split off the split
  // layout, tree/expand with no files, refresh unsupported) are simply omitted.
  const toolbarItems = useMemo<ChangesToolbarItem[]>(() => {
    const list: ChangesToolbarItem[] = [];

    if (canUseSplitLayout) {
      const isSplit = changesPreferences.layout === "split";
      list.push({
        id: "split",
        label: isSplit
          ? t("workspace.git.diff.switchToUnified")
          : t("workspace.git.diff.switchToSplit"),
        renderIcon: (size) =>
          isSplit ? (
            <ThemedAlignJustify size={size} uniProps={foregroundMutedIconColorMapping} />
          ) : (
            <ThemedColumns2 size={size} uniProps={foregroundMutedIconColorMapping} />
          ),
        onPress: handleToggleLayout,
        testID: "changes-toggle-layout",
      });
    }

    if (hasFiles) {
      const isTree = viewMode === "tree";
      list.push({
        id: "tree",
        label: isTree ? t("workspace.git.diff.showFlatView") : t("workspace.git.diff.showTreeView"),
        renderIcon: (size) =>
          isTree ? (
            <ThemedList size={size} uniProps={foregroundMutedIconColorMapping} />
          ) : (
            <ThemedFolderTree size={size} uniProps={foregroundMutedIconColorMapping} />
          ),
        onPress: handleToggleViewMode,
        testID: "changes-toggle-view-mode",
      });

      // Disable the expand direction (not collapse) once the changeset is too
      // large to expand safely; the label doubles as the tooltip explaining why.
      const expandAllDisabled = !allFileDiffsExpanded && files.length > MAX_EXPAND_ALL_FILE_COUNT;
      let expandLabel: string;
      if (allFileDiffsExpanded) {
        expandLabel = t("workspace.git.diff.collapseAll");
      } else if (expandAllDisabled) {
        expandLabel = t("workspace.git.diff.expandAllTooManyFiles");
      } else {
        expandLabel = t("workspace.git.diff.expandAll");
      }
      list.push({
        id: "expand",
        label: expandLabel,
        renderIcon: (size) =>
          allFileDiffsExpanded ? (
            <ThemedListChevronsDownUp size={size} uniProps={foregroundMutedIconColorMapping} />
          ) : (
            <ThemedListChevronsUpDown size={size} uniProps={foregroundMutedIconColorMapping} />
          ),
        onPress: handleToggleExpandAll,
        disabled: expandAllDisabled,
        testID: "changes-toggle-expand-all",
      });
    }

    list.push({
      id: "whitespace",
      label: changesPreferences.hideWhitespace
        ? t("workspace.git.diff.showWhitespace")
        : t("workspace.git.diff.hideWhitespace"),
      renderIcon: (size) => (
        <ThemedPilcrow size={size} uniProps={foregroundMutedIconColorMapping} />
      ),
      onPress: handleToggleHideWhitespace,
      testID: "changes-toggle-whitespace",
    });

    list.push({
      id: "wrap",
      label: wrapLines
        ? t("workspace.git.diff.scrollLongLines")
        : t("workspace.git.diff.wrapLongLines"),
      renderIcon: (size) => (
        <ThemedWrapText size={size} uniProps={foregroundMutedIconColorMapping} />
      ),
      onPress: handleToggleWrapLines,
      testID: "changes-toggle-wrap-lines",
    });

    if (reviewCommentCount > 0) {
      list.push({
        id: "removeComments",
        label: t("review.removeAll.action"),
        renderIcon: (size) => (
          <ThemedTrash2 size={size} uniProps={foregroundMutedIconColorMapping} />
        ),
        onPress: handleRemoveAllComments,
        separatorBefore: true,
        testID: "changes-remove-all-comments",
      });
    }

    if (refreshSupported) {
      list.push({
        id: "refresh",
        label: isRefreshing ? t("workspace.git.diff.refreshing") : t("workspace.git.diff.refresh"),
        renderIcon: (size) =>
          isRefreshing ? (
            <ThemedLoadingSpinner size={size} uniProps={foregroundMutedIconColorMapping} />
          ) : (
            <ThemedRotateCw size={size} uniProps={foregroundMutedIconColorMapping} />
          ),
        onPress: handleRefresh,
        disabled: isRefreshing,
        separatorBefore: true,
        testID: "changes-refresh",
      });
    }

    return list;
  }, [
    canUseSplitLayout,
    changesPreferences.layout,
    changesPreferences.hideWhitespace,
    hasFiles,
    files,
    viewMode,
    allFileDiffsExpanded,
    wrapLines,
    reviewCommentCount,
    refreshSupported,
    isRefreshing,
    handleToggleLayout,
    handleToggleViewMode,
    handleToggleExpandAll,
    handleToggleHideWhitespace,
    handleToggleWrapLines,
    handleRemoveAllComments,
    handleRefresh,
    t,
  ]);

  // One pane-level context menu serves every file header and diff line
  // (web right-click); per-line menus would be too heavy for large diffs.
  const canEditFiles = useTextEditorFeature(serverId);
  const [contextMenuRequest, setContextMenuRequest] = useState<DiffContextMenuRequest | null>(null);

  const handleShowFileContextMenu = useCallback((input: DiffContextMenuRequest) => {
    setContextMenuRequest(input);
  }, []);

  const handleLineContextMenu = useCallback<LineContextMenuHandler>(({ target, x, y }) => {
    // Prefer the new-side line number — that's what maps onto the file on
    // disk. Removed lines fall back to the old-side number as a near match.
    setContextMenuRequest({
      path: target.filePath,
      lineStart: target.newLineNumber ?? target.oldLineNumber ?? undefined,
      x,
      y,
    });
  }, []);

  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setContextMenuRequest(null);
    }
  }, []);

  const handleContextMenuEdit = useCallback(() => {
    if (!contextMenuRequest || !onOpenFile) {
      return;
    }
    onOpenFile(contextMenuRequest.path, { edit: true, lineStart: contextMenuRequest.lineStart });
  }, [contextMenuRequest, onOpenFile]);

  const handleContextMenuCopyPath = useCallback(() => {
    if (!contextMenuRequest) {
      return;
    }
    void Clipboard.setStringAsync(
      buildAbsoluteExplorerPath({
        workspaceRoot: normalizedWorkspaceRoot,
        entryPath: contextMenuRequest.path,
      }),
    );
  }, [contextMenuRequest, normalizedWorkspaceRoot]);

  const handleContextMenuFindInFiles = useCallback(() => {
    if (!contextMenuRequest) {
      return;
    }
    // Stash the reveal first so the Files pane finds it on mount, then switch
    // tabs. The pane expands the parent folders and scrolls the row into view.
    const { requestFilesReveal, setExplorerTabForCheckout } = usePanelStore.getState();
    requestFilesReveal(contextMenuRequest.path);
    setExplorerTabForCheckout({ serverId, cwd, isGit: true, tab: "files" });
  }, [contextMenuRequest, cwd, serverId]);

  const rollback = useDiffRollbackActions({
    serverId,
    cwd,
    diffMode,
    contextMenuPath: contextMenuRequest?.path ?? null,
    selectedPaths,
    commitSelectionEnabled,
  });

  const contextAttachmentToggle = useDiffContextAttachmentToggle({
    serverId,
    scopeKey: workspaceAttachmentScopeKey,
    request: contextMenuRequest,
  });

  const renderFlatItem = useCallback(
    ({ item }: { item: DiffFlatItem }) => {
      if (item.type === "folder") {
        return (
          <DiffFolderRow
            dirPath={item.dirPath}
            displayName={item.displayName}
            depth={item.depth}
            collapsed={item.collapsed}
            additions={item.additions}
            deletions={item.deletions}
            onToggle={handleToggleFolder}
            onHeightChange={handleFolderRowHeightChange}
            testID={`diff-folder-${item.dirPath}`}
          />
        );
      }
      if (item.type === "header") {
        return (
          <DiffFileHeader
            file={item.file}
            isExpanded={item.isExpanded}
            depth={item.depth}
            showDir={viewMode === "flat"}
            selectable={commitSelectionEnabled}
            selected={!deselectedPaths.has(item.file.path)}
            onToggleSelected={handleToggleFileSelected}
            onToggle={handleToggleExpanded}
            onHeaderHeightChange={handleHeaderHeightChange}
            onShowContextMenu={handleShowFileContextMenu}
            testID={`diff-file-${item.fileIndex}`}
          />
        );
      }
      return (
        <DiffFileBody
          file={item.file}
          layout={effectiveLayout}
          wrapLines={wrapLines}
          codeFontSize={codeFontSize}
          textMetricsStyle={diffTextMetricsStyle}
          reviewActions={reviewActions}
          onLineContextMenu={handleLineContextMenu}
          onBodyHeightChange={handleBodyHeightChange}
          testID={`diff-file-${item.fileIndex}-body`}
        />
      );
    },
    [
      codeFontSize,
      commitSelectionEnabled,
      deselectedPaths,
      diffTextMetricsStyle,
      effectiveLayout,
      handleBodyHeightChange,
      handleFolderRowHeightChange,
      handleHeaderHeightChange,
      handleLineContextMenu,
      handleShowFileContextMenu,
      handleToggleExpanded,
      handleToggleFileSelected,
      handleToggleFolder,
      reviewActions,
      viewMode,
      wrapLines,
    ],
  );

  const flatKeyExtractor = useCallback(
    (item: DiffFlatItem) =>
      item.type === "folder" ? `folder-${item.dirPath}` : `${item.type}-${item.file.path}`,
    [],
  );

  const getFlatItemLayout = useCallback<DiffFlatItemLayoutGetter>(
    (_data, index) => {
      const offset = sumHeightsBefore(flatItems, index, getFlatItemHeight);
      const item = flatItems[index];
      const length = item ? getFlatItemHeight(item) : 0;
      return { length, offset, index };
    },
    [flatItems, getFlatItemHeight],
  );

  const flatExtraData = useMemo(
    () => ({
      expandedPathsArray,
      collapsedFoldersArray,
      commitSelectionEnabled,
      deselectedPaths,
      effectiveLayout,
      diffBodyTypographyKey,
      heightVersion,
      viewMode,
      wrapLines,
      reviewActions,
    }),
    [
      expandedPathsArray,
      collapsedFoldersArray,
      commitSelectionEnabled,
      deselectedPaths,
      effectiveLayout,
      diffBodyTypographyKey,
      heightVersion,
      viewMode,
      wrapLines,
      reviewActions,
    ],
  );

  const hasChanges = files.length > 0;
  const diffErrorMessage = diffPayloadError?.message ?? null;
  const prErrorMessage = computePrErrorMessage(githubFeaturesEnabled, prPayloadError);
  const baseRefLabel = useMemo(
    () => computeBaseRefLabel(baseRef, t("workspace.git.diff.base")),
    [baseRef, t],
  );
  const iconSize = useIconSize();
  const actionIconSize = iconSize.md;
  const gitActionsIcons = useMemo(
    () => ({
      commit: (
        <ThemedGitCommitHorizontal
          size={actionIconSize}
          uniProps={foregroundMutedIconColorMapping}
        />
      ),
      pull: <ThemedDownload size={actionIconSize} uniProps={foregroundMutedIconColorMapping} />,
      push: <ThemedUpload size={actionIconSize} uniProps={foregroundMutedIconColorMapping} />,
      pullAndPush: (
        <ThemedArrowDownUp size={actionIconSize} uniProps={foregroundMutedIconColorMapping} />
      ),
      viewPr: (provider: GitHostingProviderId) => (
        <ThemedGitHostingIcon
          provider={provider}
          size={actionIconSize}
          uniProps={foregroundMutedIconColorMapping}
        />
      ),
      createPr: (provider: GitHostingProviderId) => (
        <ThemedGitHostingIcon
          provider={provider}
          size={actionIconSize}
          uniProps={foregroundMutedIconColorMapping}
        />
      ),
      mergePrSquash: (provider: GitHostingProviderId) => (
        <ThemedGitHostingIcon
          provider={provider}
          size={actionIconSize}
          uniProps={foregroundMutedIconColorMapping}
        />
      ),
      mergePrMerge: (provider: GitHostingProviderId) => (
        <ThemedGitHostingIcon
          provider={provider}
          size={actionIconSize}
          uniProps={foregroundMutedIconColorMapping}
        />
      ),
      mergePrRebase: (provider: GitHostingProviderId) => (
        <ThemedGitHostingIcon
          provider={provider}
          size={actionIconSize}
          uniProps={foregroundMutedIconColorMapping}
        />
      ),
      merge: <ThemedGitMerge size={actionIconSize} uniProps={foregroundMutedIconColorMapping} />,
      mergeFromBase: (
        <ThemedRefreshCcw size={actionIconSize} uniProps={foregroundMutedIconColorMapping} />
      ),
      archive: <ThemedArchive size={actionIconSize} uniProps={foregroundMutedIconColorMapping} />,
    }),
    [actionIconSize],
  );
  const { gitActions, branchLabel } = useGitActions({
    serverId,
    cwd,
    icons: gitActionsIcons,
  });
  const committedDiffDescription = useMemo(
    () => computeCommittedDiffDescription(branchLabel, baseRefLabel),
    [baseRefLabel, branchLabel],
  );
  const uncommittedLabel = t("workspace.git.diff.uncommitted");
  const committedLabel = t("workspace.git.diff.committed");

  const emptyMessage = computeEmptyMessage(
    changesPreferences.hideWhitespace,
    diffMode,
    baseRefLabel,
    {
      hiddenWhitespace: t("workspace.git.diff.emptyHiddenWhitespace"),
      uncommitted: t("workspace.git.diff.emptyUncommitted"),
      againstBase: (label) => t("workspace.git.diff.emptyAgainstBase", { baseRef: label }),
    },
  );

  const bodyContent: ReactElement = (
    <DiffBodyContent
      isStatusLoading={isStatusLoading}
      statusErrorMessage={statusErrorMessage}
      notGit={notGit}
      isDiffLoading={isDiffLoading}
      diffErrorMessage={diffErrorMessage}
      hasChanges={hasChanges}
      emptyMessage={emptyMessage}
      flatItems={flatItems}
      stickyHeaderIndices={stickyHeaderIndices}
      renderFlatItem={renderFlatItem}
      flatKeyExtractor={flatKeyExtractor}
      getFlatItemLayout={getFlatItemLayout}
      flatExtraData={flatExtraData}
      diffListRef={diffListRef}
      handleDiffListLayout={handleDiffListLayout}
      handleDiffListScroll={handleDiffListScroll}
      onContentSizeChange={scrollbar.onContentSizeChange}
      showWebScrollbar={showWebScrollbar}
      checkingRepositoryLabel={t("workspace.git.diff.checkingRepository")}
      notRepositoryLabel={t("workspace.git.diff.notRepository")}
    />
  );

  return (
    <View style={styles.container}>
      {isGit && (currentBranchName || isMobile) ? (
        <View style={styles.header} testID="changes-header">
          <View style={styles.headerBranchArea}>
            <BranchSwitcher
              currentBranchName={currentBranchName}
              serverId={serverId}
              workspaceId={workspaceId ?? cwd}
              workspaceDirectory={cwd}
              isGitCheckout={isGit}
              testID="changes-branch-switcher"
            />
          </View>
          {isMobile ? <GitActionsSplitButton gitActions={gitActions} /> : null}
        </View>
      ) : null}

      {isGit ? (
        <View style={styles.diffStatusContainer}>
          <View
            style={styles.diffStatusInner}
            onPointerEnter={handleToolbarPointerEnter}
            onPointerLeave={handleToolbarPointerLeave}
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                style={diffModeTriggerStyle}
                testID="changes-diff-status"
                accessibilityRole="button"
                accessibilityLabel={t("workspace.git.diff.diffMode")}
              >
                <Text style={styles.diffStatusText} numberOfLines={1}>
                  {diffMode === "uncommitted" ? uncommittedLabel : committedLabel}
                </Text>
                <ThemedChevronDown size={iconSize.xs} uniProps={foregroundMutedIconColorMapping} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" width={260} testID="changes-diff-status-menu">
                <DropdownMenuItem
                  testID="changes-diff-mode-uncommitted"
                  selected={diffMode === "uncommitted"}
                  onSelect={handleSelectUncommitted}
                >
                  {uncommittedLabel}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  testID="changes-diff-mode-committed"
                  selected={diffMode === "base"}
                  description={committedDiffDescription}
                  onSelect={handleSelectBase}
                >
                  {committedLabel}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ChangesToolbar
              items={toolbarItems}
              pinnedItems={pinnedToolbarItems}
              onTogglePin={handleToggleToolbarPin}
              hovered={toolbarHovered}
              isMobile={isMobile}
              hideUntilHover={appSettings.hidePinnedToolbarOptions}
              optionsLabel={t("workspace.git.diff.options")}
            />
          </View>
        </View>
      ) : null}

      {prErrorMessage ? <Text style={styles.actionErrorText}>{prErrorMessage}</Text> : null}

      <View style={styles.diffContainer}>
        {bodyContent}
        {hasChanges ? scrollbar.overlay : null}
      </View>

      <ChangesCommitSection
        serverId={serverId}
        cwd={cwd}
        workspaceId={workspaceId}
        selectedPaths={selectedPaths}
        totalFiles={files.length}
        commitSupported={commitSupported}
        logSupported={gitLogSupported}
        isGit={isGit}
        diffMode={diffMode}
        hasChanges={hasChanges}
        onToggleSelectAll={handleToggleSelectAll}
        onCommitted={clearCommitSelection}
      />

      <ContextMenu
        open={contextMenuRequest !== null}
        onOpenChange={handleContextMenuOpenChange}
        anchor={contextMenuRequest}
      >
        <ContextMenuContent width={220} testID="changes-context-menu">
          <DiffContextToggleMenuItem toggle={contextAttachmentToggle} />
          {canEditFiles && onOpenFile ? (
            <ContextMenuItem
              leading={DIFF_CONTEXT_EDIT_ICON}
              onSelect={handleContextMenuEdit}
              testID="changes-context-menu-edit"
            >
              {t("workspace.fileExplorer.context.edit")}
            </ContextMenuItem>
          ) : null}
          <DiffContextHistoryMenuItem
            serverId={serverId}
            workspaceId={workspaceId}
            request={contextMenuRequest}
          />
          <ContextMenuItem
            leading={DIFF_CONTEXT_FIND_IN_FILES_ICON}
            onSelect={handleContextMenuFindInFiles}
            testID="changes-context-menu-find-in-files"
          >
            {t("workspace.fileExplorer.context.findInFiles")}
          </ContextMenuItem>
          <ContextMenuItem
            leading={DIFF_CONTEXT_COPY_PATH_ICON}
            onSelect={handleContextMenuCopyPath}
            testID="changes-context-menu-copy-path"
          >
            {t("workspace.fileExplorer.context.copyPath")}
          </ContextMenuItem>
          <DiffRollbackMenuItems rollback={rollback} />
        </ContextMenuContent>
      </ContextMenu>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    // Fixed chrome height — content (branch-name casing, platform font
    // metrics) must never drive the bar height. Desktop matches the
    // diff-status bar below (WORKSPACE_SECONDARY_HEADER_HEIGHT); compact
    // keeps the previous rendered height, fitting the GitActionsSplitButton
    // (34px incl. borders) with breathing room.
    height: {
      xs: 46,
      md: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    },
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerBranchArea: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    justifyContent: "center",
  },
  diffStatusContainer: {
    // Matches the neighboring pane-chrome toolbars (file editor mode bar,
    // visualizer bar — all PANE_TOOLBAR_HEIGHT) so the divider lines up across a
    // split rather than sitting a few px high. diffStatusInner centers content.
    height: PANE_TOOLBAR_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  diffStatusInner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: theme.spacing[3],
  },
  diffModeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    // Align text with header branch icon (at spacing[3] from edge, minus our horizontal padding)
    marginLeft: theme.spacing[3] - theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    height: {
      xs: 28,
      sm: 28,
      md: 24,
    },
    borderRadius: theme.borderRadius.base,
    flexShrink: 0,
  },
  diffModeTriggerHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  diffModeTriggerPressed: {
    backgroundColor: theme.colors.surface2,
  },
  diffStatusRowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  diffStatusText: {
    // Explicit compact bump matching the branch switcher's label treatment.
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    lineHeight: {
      xs: (theme.fontSize.xs + 2) * 1.25,
      md: theme.fontSize.xs * 1.25,
    },
    color: theme.colors.foregroundMuted,
  },
  diffStatusIconHidden: {
    opacity: 0,
  },
  actionErrorText: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
  diffContainer: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: theme.spacing[8],
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
    gap: theme.spacing[4],
  },
  loadingText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
    paddingHorizontal: theme.spacing[6],
  },
  errorText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.destructive,
    textAlign: "center",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
  },
  emptyText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.foregroundMuted,
  },
  fileSection: {
    overflow: "hidden",
    backgroundColor: theme.colors.surface2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  fileSectionHeaderContainer: {
    overflow: "hidden",
  },
  fileSectionHeaderExpanded: {
    backgroundColor: theme.colors.surface1,
  },
  fileSectionBodyContainer: {
    overflow: "hidden",
    backgroundColor: theme.colors.surface2,
  },
  fileSectionBorder: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    // ~2px tighter than spacing[3] (12) so the file checkbox sits closer to the
    // panel edge, matching the trimmed commit-section inset below.
    paddingLeft: 10,
    paddingRight: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
    minWidth: 0,
    zIndex: 2,
    elevation: 2,
  },
  fileHeaderPressed: {
    opacity: 0.7,
  },
  fileHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  fileHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  fileIcon: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  fileCheckbox: {
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing[1],
  },
  fileCheckboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  fileCheckboxIndeterminateMark: {
    width: 8,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.accentForeground,
  },
  commitSection: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    // Trim the horizontal inset slightly (was spacing[3] = 12 both sides) so the
    // message input, checkbox row, and commit button align better with the file
    // rows above: ~3px off the left, ~2px off the right.
    paddingLeft: 9,
    paddingRight: 10,
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[2],
  },
  commitInput: {
    minHeight: 56,
    maxHeight: 120,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    // Compact bump: +2px on mobile, matching the file list and count text.
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    lineHeight: {
      xs: (theme.fontSize.sm + 2) * 1.4,
      md: theme.fontSize.sm * 1.4,
    },
    textAlignVertical: "top",
    ...(isWeb
      ? {
          outlineWidth: 0,
          outlineColor: "transparent",
        }
      : {}),
  },
  commitInputFocused: {
    borderColor: theme.colors.accent,
  },
  commitPlaceholderColor: {
    color: theme.colors.foregroundMuted,
  },
  commitActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  commitSelectionGroup: {
    flexDirection: "row",
    alignItems: "center",
    // The checkbox's built-in marginRight (4px) plus this gap matches the 8px
    // the file rows get from marginRight + fileHeaderLeft's gap, so the count
    // text lines up with the filenames below.
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
  },
  commitSelectionCount: {
    color: theme.colors.foregroundMuted,
    // Compact bump: +2px on mobile, matching the file list and commit box.
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    flexShrink: 1,
  },
  commitButtonGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  commitUnsupportedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  commitErrorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.4,
  },
  commitErrorDetail: {
    color: theme.colors.foregroundMuted,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.5,
    fontFamily: theme.fontFamily.mono,
  },
  fileName: {
    // Compact bump: +2px on mobile for readability, matching diffStatusText. The
    // row is auto-height and already tall enough, so this doesn't grow it.
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
    flexShrink: 1,
    minWidth: 0,
  },
  fileDir: {
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    flex: 1,
    minWidth: 0,
  },
  fileDirSpacer: {
    flex: 1,
    minWidth: 0,
  },
  newBadge: {
    backgroundColor: "rgba(46, 160, 67, 0.2)",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    flexShrink: 0,
  },
  newBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffAddition,
  },
  deletedBadge: {
    backgroundColor: "rgba(248, 81, 73, 0.2)",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    flexShrink: 0,
  },
  deletedBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffDeletion,
  },
  additions: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffAddition,
  },
  deletions: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffDeletion,
  },
  diffContent: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  diffContentRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  diffContentInner: {
    flexDirection: "column",
  },
  linesContainer: {
    backgroundColor: theme.colors.surface1,
  },
  gutterColumn: {
    backgroundColor: theme.colors.surface1,
    zIndex: 4,
    elevation: 4,
    overflow: "visible",
  },
  gutterCell: {
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
    justifyContent: "flex-start",
    zIndex: 4,
    elevation: 4,
    overflow: "visible",
  },
  inlineReviewRow: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: theme.colors.surface1,
  },
  inlineReviewGutterSpacer: {
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    flexShrink: 0,
  },
  textLineContainer: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingLeft: theme.spacing[2],
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  splitColumnScroll: {
    flex: 1,
  },
  splitHeaderRow: {
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[3],
  },
  splitCell: {
    flex: 1,
    flexBasis: 0,
    backgroundColor: theme.colors.surface2,
  },
  splitCellRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  emptySplitCell: {
    backgroundColor: theme.colors.surfaceDiffEmpty,
  },
  splitCellWithDivider: {
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
  },
  diffLineContainer: {
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "visible",
  },
  lineNumberGutter: {
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
    marginRight: theme.spacing[2],
    alignSelf: "stretch",
    justifyContent: "flex-start",
    zIndex: 4,
    elevation: 4,
    overflow: "visible",
  },
  diffTextMetrics: {
    fontSize: theme.fontSize.code,
    lineHeight: theme.lineHeight.diff,
    fontFamily: theme.fontFamily.mono,
  },
  lineNumberText: {
    width: "100%",
    textAlign: "right",
    paddingRight: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    userSelect: "none",
  },
  addLineNumberText: {
    color: theme.colors.diffAddition,
  },
  removeLineNumberText: {
    color: theme.colors.diffDeletion,
  },
  diffLineText: {
    flex: 1,
    paddingRight: theme.spacing[3],
    color: theme.colors.foreground,
    userSelect: "text",
  },
  addLineContainer: {
    backgroundColor: "rgba(46, 160, 67, 0.15)", // GitHub green
  },
  addLineText: {
    color: theme.colors.foreground,
  },
  removeLineContainer: {
    backgroundColor: "rgba(248, 81, 73, 0.1)", // GitHub red
  },
  removeLineText: {
    color: theme.colors.foreground,
  },
  headerLineContainer: {
    backgroundColor: theme.colors.surface2,
  },
  headerLineText: {
    color: theme.colors.foregroundMuted,
  },
  contextLineContainer: {
    backgroundColor: theme.colors.surface1,
  },
  contextLineText: {
    color: theme.colors.foregroundMuted,
  },
  emptySplitCellText: {
    color: "transparent",
  },
  statusMessageContainer: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[4],
  },
  statusMessageText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontStyle: "italic",
  },
  tooltipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
}));

const FILE_SECTION_BODY_STYLE = [styles.fileSectionBodyContainer, styles.fileSectionBorder];
const SELECTED_FILE_CHECKBOX_STYLE = [styles.fileCheckbox, styles.fileCheckboxChecked];
const DIFF_CONTENT_SPLIT_ROW_STYLE = [styles.diffContent, styles.splitRow];
const DIFF_CONTENT_ROW_STYLE = [styles.diffContent, styles.diffContentRow];
const DIFF_HEIGHT_CHANGE_EPSILON = 0.5;
