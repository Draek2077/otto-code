// The bridge between the native `MathFormula` host and the KaTeX payload that
// runs inside its webview. Kept dependency-free so both sides can import it:
// the payload is bundled separately by scripts/build-math-webview-html.mjs and
// must not drag React or anything else from the app graph in with it.

/** Host → webview. */
export interface MathWebViewInbound {
  type: "render";
  requestId: number;
  /** The TeX between the delimiters, exactly as written. */
  tex: string;
  /** KaTeX's `displayMode`. */
  display: boolean;
  /**
   * A concrete colour, never a `var()`: the payload's document has no theme to
   * resolve one against, and KaTeX draws rules and radicals with `currentColor`.
   */
  color: string;
  /** The surrounding text's size in px. KaTeX sizes everything else in em. */
  fontSize: number;
}

/** Webview → host. */
export type MathWebViewOutbound =
  | { type: "ready" }
  /** Laid-out size in CSS pixels, after any fit-to-width scaling. */
  | { type: "rendered"; requestId: number; width: number; height: number }
  | { type: "error"; requestId: number; message: string }
  /** Emitted when the laid-out formula changes size (viewport width change). */
  | { type: "resized"; width: number; height: number };

/**
 * How long a formula must stop changing before it is rendered.
 *
 * The markdown library remints node keys on every parse, so a document being
 * typed into remounts the host on each keystroke. The host mounts no webview
 * until this timer fires, which is what keeps that from creating and tearing
 * down a webview per character.
 */
export const MATH_RENDER_DEBOUNCE_MS = 120;
