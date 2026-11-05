import { EditorView } from "@codemirror/view";
import type { EditorVisualTheme } from "@/file-pane/editor/extensions.web";
import { createOverviewRulerExtension } from "./overview-ruler";
export interface EditorProblemColors {
  error: string;
  warning: string;
  info: string;
}
/** The original annotation lane, projected from the active Paseo palette. */
export function overviewRuler(theme: EditorVisualTheme, problems: EditorProblemColors) {
  return [
    createOverviewRulerExtension({ readTheme: () => ({ overviewRulerWidth: 14 }) }),
    EditorView.theme({
      ".cm-scroller": { paddingRight: "14px", scrollbarWidth: "none" },
      ".cm-scroller::-webkit-scrollbar:vertical": { display: "none", width: "0" },
      ".cm-otto-overview": {
        position: "absolute",
        top: "0",
        right: "0",
        bottom: "0",
        width: "14px",
        backgroundColor: theme.background,
        borderLeft: `1px solid ${theme.border}`,
        zIndex: "5",
        cursor: "pointer",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
      },
      ".cm-otto-overview-marks, .cm-otto-overview-selections": {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
      },
      ".cm-otto-overview-mark": { position: "absolute", top: "0", borderRadius: "1px" },
      ".cm-otto-overview-mark-problem": { left: "1px", width: "5px" },
      ".cm-otto-overview-mark-error": { backgroundColor: problems.error },
      ".cm-otto-overview-mark-warning": { backgroundColor: problems.warning },
      ".cm-otto-overview-mark-info": { backgroundColor: problems.info },
      ".cm-otto-overview-mark-hint": { backgroundColor: theme.foregroundMuted },
      ".cm-otto-overview-mark-match": {
        right: "1px",
        width: "5px",
        backgroundColor: problems.warning,
      },
      ".cm-otto-overview-mark-match-active": { left: "1px", right: "1px", width: "auto" },
      ".cm-otto-overview-band": {
        position: "absolute",
        top: "0",
        left: "0",
        right: "0",
        backgroundColor: theme.selection,
      },
      ".cm-otto-overview-cursor": {
        position: "absolute",
        top: "0",
        left: "0",
        right: "0",
        height: "2px",
        backgroundColor: theme.cursor,
        pointerEvents: "none",
      },
      ".cm-otto-overview-thumb": {
        position: "absolute",
        top: "0",
        left: "0",
        right: "0",
        backgroundColor: theme.foreground,
        opacity: "0.18",
        pointerEvents: "none",
      },
    }),
  ];
}
