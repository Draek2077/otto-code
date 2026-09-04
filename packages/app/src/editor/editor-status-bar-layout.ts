import type { CodeDiagnostic } from "@otto-code/protocol/messages";

type DiagnosticSeverity = CodeDiagnostic["severity"];

export interface EditorStatusBarLayout {
  showFileSize: boolean;
  showImageDimensions: boolean;
  showEol: boolean;
  showEncoding: boolean;
  showSelection: boolean;
  diagnosticSeverities: readonly DiagnosticSeverity[];
}

const CRITICAL_DIAGNOSTICS: readonly DiagnosticSeverity[] = ["error", "warning"];
const COMPACT_DIAGNOSTICS: readonly DiagnosticSeverity[] = [...CRITICAL_DIAGNOSTICS, "info"];
const ALL_DIAGNOSTICS: readonly DiagnosticSeverity[] = [...COMPACT_DIAGNOSTICS, "hint"];

// These are container widths, not device breakpoints. A File Editor can be narrow
// on a desktop split just as readily as it can be on a phone, and the status bar
// must budget against the space it actually receives.
const COMPACT_WIDTH = 440;
const FULL_WIDTH = 640;

/**
 * Keeps the status bar to the facts a reader needs at its current width.
 *
 * Cursor position, Vim state, language, errors, and warnings survive the narrow
 * tier. File metadata and advisory diagnostics earn their room back in order as
 * the bar grows. Zero is the pre-measurement state and intentionally takes the
 * narrow tier so the first frame never overflows before `onLayout` arrives.
 */
export function resolveEditorStatusBarLayout(width: number): EditorStatusBarLayout {
  if (width < COMPACT_WIDTH) {
    return {
      showFileSize: false,
      showImageDimensions: false,
      showEol: false,
      showEncoding: false,
      showSelection: false,
      diagnosticSeverities: CRITICAL_DIAGNOSTICS,
    };
  }

  if (width < FULL_WIDTH) {
    return {
      showFileSize: true,
      showImageDimensions: true,
      showEol: true,
      showEncoding: false,
      showSelection: false,
      diagnosticSeverities: COMPACT_DIAGNOSTICS,
    };
  }

  return {
    showFileSize: true,
    showImageDimensions: true,
    showEol: true,
    showEncoding: true,
    showSelection: true,
    diagnosticSeverities: ALL_DIAGNOSTICS,
  };
}
