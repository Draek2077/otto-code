import type { MermaidRenderResult, MermaidThemeConfig } from "./mermaid-contract";
import { buildMermaidThemeVariables } from "./mermaid-theme";

// The one place that knows about the mermaid library. Requires a DOM (mermaid
// measures label text by laying it out), so it only ever runs on web/Electron
// or inside the native webview payload - never in the React Native runtime.
//
// The `import("mermaid")` is deliberately dynamic: mermaid is ~3.4 MB minified
// and must stay out of the startup graph (see docs/feature-flags.md on Metro's
// no-tree-shake constraint - a dynamic boundary is the only lever that works).

const MAX_DIAGRAM_SOURCE_LENGTH = 50_000;

let sequence = 0;

/** Mermaid needs a DOM id per render; ids must be unique and CSS-safe. */
function nextRenderId(): string {
  sequence += 1;
  return `otto-mermaid-${sequence}`;
}

/**
 * Mermaid renders into a detached probe element it creates from the render id.
 * A throwing render can leave that element parented to `document.body`, which
 * accumulates invisible nodes over a session of malformed fences.
 */
function removeRenderProbe(id: string): void {
  for (const candidate of [id, `d${id}`]) {
    document.getElementById(candidate)?.remove();
  }
}

function parseViewBox(svg: string): { width: number; height: number } | null {
  const match = /viewBox=["']\s*([-\d.]+)[,\s]+([-\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*["']/.exec(
    svg,
  );
  if (!match) return null;
  const width = Number(match[3]);
  const height = Number(match[4]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function stripSvgMaxWidth(openingTag: string): string {
  return openingTag.replace(/\sstyle=(["'])(.*?)\1/i, (_full, quote: string, style: string) => {
    const remaining = style
      .split(";")
      .filter((declaration) => !/^\s*max-width\s*:/i.test(declaration))
      .join(";")
      .trim();
    return remaining.length > 0 ? ` style=${quote}${remaining}${quote}` : "";
  });
}

/**
 * Hand sizing control to the caller.
 *
 * Mermaid's `useMaxWidth` emits `width="100%"` plus an inline
 * `max-width: <natural>px` on the `<svg>`. That inline cap fights any container
 * that wants to scale the diagram, so it is stripped and the natural size is
 * returned instead - the host applies it as a container `maxWidth` and lets the
 * viewBox drive the height.
 */
function normalizeSvgSizing(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/i, (openingTag) => {
    const stripped = stripSvgMaxWidth(openingTag)
      .replace(/\swidth=(["']).*?\1/gi, "")
      .replace(/\sheight=(["']).*?\1/gi, "");
    return stripped.replace(/^<svg/i, '<svg width="100%"');
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  // Mermaid throws bare objects carrying `str` for some grammar failures.
  if (error && typeof error === "object" && "str" in error) {
    const str = (error as { str?: unknown }).str;
    if (typeof str === "string" && str.trim().length > 0) {
      return str.trim();
    }
  }
  return "Could not render this diagram.";
}

/**
 * Render mermaid source to an SVG string.
 *
 * Throws with a human-readable message on anything malformed; callers show the
 * source instead. Never resolves with an empty or zero-sized diagram - a
 * missing viewBox is treated as a failure so no caller can end up drawing an
 * empty box.
 */
export async function renderMermaid(
  code: string,
  theme: MermaidThemeConfig,
): Promise<MermaidRenderResult> {
  const source = code.trim();
  if (source.length === 0) {
    throw new Error("Empty diagram.");
  }
  if (source.length > MAX_DIAGRAM_SOURCE_LENGTH) {
    throw new Error("Diagram source is too large to render.");
  }

  const { default: mermaid } = await import("mermaid");

  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    // Sanitizes labels and drops `click` directives, so a diagram in an
    // untrusted repo document cannot script or navigate anything.
    securityLevel: "strict",
    suppressErrorRendering: true,
    fontFamily: theme.fontFamily,
    themeVariables: buildMermaidThemeVariables(theme),
    flowchart: { useMaxWidth: true },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
  });

  const id = nextRenderId();
  try {
    const { svg } = await mermaid.render(id, source);
    const size = parseViewBox(svg);
    if (!size) {
      throw new Error("Diagram produced no drawable output.");
    }
    return { svg: normalizeSvgSizing(svg), width: size.width, height: size.height };
  } catch (error) {
    throw new Error(toErrorMessage(error), { cause: error });
  } finally {
    removeRenderProbe(id);
  }
}

export type MermaidOutcome =
  | { status: "rendered"; result: MermaidRenderResult }
  | { status: "failed"; message: string };

// Bounded so a long session of streamed diagrams can't grow without limit; the
// working set a reader can see at once is a handful.
const OUTCOME_CACHE_LIMIT = 32;
const outcomes = new Map<string, MermaidOutcome>();

function outcomeKey(code: string, theme: MermaidThemeConfig): string {
  // A NUL keeps the two halves unambiguous without a literal control
  // character in the source.
  return `${JSON.stringify(theme)}\u0000${code}`;
}

/**
 * A previously computed outcome for exactly this source and theme, if there is
 * one.
 *
 * react-native-markdown-display mints fresh node keys on every parse, so a
 * markdown surface that re-parses (a streaming chat message, a re-read file)
 * unmounts and remounts every block. Without this, each remount would pay for a
 * full mermaid render - and would flash the source while doing it.
 */
export function peekMermaidOutcome(
  code: string,
  theme: MermaidThemeConfig,
): MermaidOutcome | undefined {
  return outcomes.get(outcomeKey(code, theme));
}

/** Render (or recall) an outcome. Never throws - failure is a return value. */
export async function resolveMermaidOutcome(
  code: string,
  theme: MermaidThemeConfig,
): Promise<MermaidOutcome> {
  const key = outcomeKey(code, theme);
  const cached = outcomes.get(key);
  if (cached) {
    return cached;
  }

  let outcome: MermaidOutcome;
  try {
    outcome = { status: "rendered", result: await renderMermaid(code, theme) };
  } catch (error) {
    outcome = {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (outcomes.size >= OUTCOME_CACHE_LIMIT) {
    const oldest = outcomes.keys().next();
    if (!oldest.done) {
      outcomes.delete(oldest.value);
    }
  }
  outcomes.set(key, outcome);
  return outcome;
}
