import type { WorkspaceFileLocation } from "@/workspace/file-open";
import type { EditorVisualTheme } from "../editor/extensions.web";

/** A source search hit, expressed in the same line-relative form as the file preview. */
export interface SourceFindMatch {
  line: number;
  start: number;
  end: number;
  active: boolean;
}

export interface SourceScrollMetrics {
  scrollTop: number;
  contentHeight: number;
  clientHeight: number;
}

export interface SourcePointerDown {
  contentY: number;
  viewportOffsetY: number;
  contentHeight: number;
}

/**
 * The small Otto extension seam over Paseo's source renderer. It lets the
 * enclosing file tab coordinate a virtual source view with its editor twin
 * without taking source rendering back into the tab itself.
 */
export interface FileSourceViewHandle {
  getMetrics(): SourceScrollMetrics;
  scrollToFraction(fraction: number): void;
  scrollToContentY(contentY: number, viewportOffsetY: number): void;
  scrollToLine(line: number): void;
}

export interface FileSourceViewProps {
  content: string;
  filename: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  size: number;
  theme: EditorVisualTheme;
  tooLargeMessage: string;
  /** Otto preview extension: syntax-source find marks and its current result. */
  findMatches?: readonly SourceFindMatch[];
  /** Otto preview extension: mirror the editor's soft-wrap setting. */
  wrapLines?: boolean;
  /** Otto preview extension: split-pane and outline scroll coordination. */
  onScrolledSync?: (metrics: SourceScrollMetrics) => void;
  onPointerDownSync?: (pointer: SourcePointerDown) => void;
}
