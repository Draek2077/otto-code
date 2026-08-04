// Shared types for the mermaid subsystem. Kept dependency-free so both the
// app-side hosts and the native webview payload (bundled separately by
// scripts/build-mermaid-webview-html.mjs) can import them.

/**
 * Otto's theme flattened into the handful of concrete color/font values mermaid
 * needs. Mermaid derives further shades from these with color math, so every
 * value must be a real color - never a CSS `var()` reference.
 */
export interface MermaidThemeConfig {
  dark: boolean;
  background: string;
  surface: string;
  border: string;
  foreground: string;
  foregroundMuted: string;
  accent: string;
  fontFamily: string;
  fontSize: number;
}

export interface MermaidRenderResult {
  svg: string;
  /** Intrinsic size from the SVG viewBox, in CSS pixels. */
  width: number;
  height: number;
}

/** Host → webview. */
export interface MermaidWebViewInbound {
  type: "render";
  requestId: number;
  code: string;
  theme: MermaidThemeConfig;
}

/** Webview → host. */
export type MermaidWebViewOutbound =
  | { type: "ready" }
  | { type: "rendered"; requestId: number; height: number }
  | { type: "error"; requestId: number; message: string }
  /** Emitted when the laid-out diagram changes height (viewport width change). */
  | { type: "resized"; height: number };

/**
 * The fence info string that turns a code fence into a diagram.
 *
 * Matched on the first whitespace-delimited token so ` ```mermaid {theme} `
 * style attribute suffixes (common in docs tooling) still render. `mmd` is the
 * conventional short form and the extension of standalone diagram files.
 */
export function isMermaidFenceLanguage(info: string | null | undefined): boolean {
  if (!info) return false;
  const first = info.trim().split(/\s+/, 1)[0]?.toLowerCase();
  return first === "mermaid" || first === "mmd";
}
