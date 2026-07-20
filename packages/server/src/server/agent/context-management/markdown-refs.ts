/**
 * Extracts the two kinds of outbound reference a context file can carry
 * (charter §2.1):
 *
 * - **import** — `@docs/foo.md`. Inlined into the request, recursively.
 * - **reference** — `[foo](docs/foo.md)`. Costs only the link text; the model
 *   may or may not read it.
 *
 * Both carry the byte range of the whole token, which is what lets the UI
 * convert one into the other as a single-span edit (charter §7.1).
 *
 * Code fences and inline code spans are masked before matching, so a `@handle`
 * inside an example block is not mistaken for an import. Masking preserves
 * length so every offset still indexes the original text.
 */

export type MarkdownRefKind = "import" | "reference";

export interface MarkdownRef {
  kind: MarkdownRefKind;
  /** Path text exactly as written, before resolution. */
  rawTarget: string;
  /** Byte range of the entire token in the source text. */
  start: number;
  end: number;
}

/**
 * Replaces fenced blocks and inline code with spaces, keeping the string the
 * same length so match offsets stay valid against the original.
 */
function maskCode(text: string): string {
  let masked = text;
  // Fenced blocks: ``` or ~~~ ... matching closing fence (or end of file).
  masked = masked.replace(
    /(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n?([\s\S]*?)(\n[ \t]*\3|$)/g,
    (match) => blankOut(match),
  );
  // Inline code spans, longest-run-first so ``a ` b`` stays intact.
  masked = masked.replace(/(`+)(?!`)[\s\S]*?\1(?!`)/g, (match) => blankOut(match));
  return masked;
}

/** Same length, newlines preserved so line-based reasoning still works. */
function blankOut(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

/** Trailing sentence punctuation is never part of a path. */
function trimTrailingPunctuation(target: string): string {
  return target.replace(/[.,;:!?)\]]+$/, "");
}

function isExternalTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") || target.startsWith("#");
}

/**
 * A bare `@` mention only counts as an import when it looks like a path: it has
 * a separator, a home prefix, or a file extension. `@otto-code/protocol` still
 * slips through this net by design — the scanner filters candidates by
 * existence, which is the only reliable test (charter §2.4: resolution decides).
 */
function looksLikePath(target: string): boolean {
  if (target.length === 0) return false;
  return (
    target.startsWith("~") ||
    target.startsWith("./") ||
    target.startsWith("../") ||
    target.startsWith("/") ||
    target.includes("/") ||
    /\.[a-z0-9]+$/i.test(target)
  );
}

export function extractMarkdownRefs(text: string): MarkdownRef[] {
  const masked = maskCode(text);
  const refs: MarkdownRef[] = [];

  // Imports: `@path`, at line start or after whitespace. Not inside a word, and
  // not an email local part (guarded by requiring a preceding boundary).
  const importPattern = /(^|[\s(])@([^\s)\]]+)/g;
  for (const match of masked.matchAll(importPattern)) {
    const prefix = match[1] ?? "";
    const rawCandidate = match[2] ?? "";
    const rawTarget = trimTrailingPunctuation(rawCandidate);
    if (!looksLikePath(rawTarget)) continue;
    if (isExternalTarget(rawTarget)) continue;
    const start = (match.index ?? 0) + prefix.length;
    refs.push({ kind: "import", rawTarget, start, end: start + 1 + rawTarget.length });
  }

  // Inline links: `[text](target "optional title")`.
  const linkPattern = /\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of masked.matchAll(linkPattern)) {
    const rawTarget = match[1] ?? "";
    if (rawTarget.length === 0 || isExternalTarget(rawTarget)) continue;
    const start = match.index ?? 0;
    refs.push({ kind: "reference", rawTarget, start, end: start + match[0].length });
  }

  // Reference-style definitions: `[label]: target`.
  const definitionPattern = /^[ \t]*\[[^\]\n]+\]:[ \t]*(\S+)/gm;
  for (const match of masked.matchAll(definitionPattern)) {
    const rawTarget = match[1] ?? "";
    if (rawTarget.length === 0 || isExternalTarget(rawTarget)) continue;
    const start = match.index ?? 0;
    refs.push({ kind: "reference", rawTarget, start, end: start + match[0].length });
  }

  return refs.sort((a, b) => a.start - b.start);
}

/** Strips a `#anchor` / `?query` tail so the path can be resolved on disk. */
export function stripTargetFragment(rawTarget: string): string {
  const cut = rawTarget.search(/[#?]/);
  return cut === -1 ? rawTarget : rawTarget.slice(0, cut);
}

export function isMarkdownTarget(target: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(stripTargetFragment(target));
}

/** Only paths that name a file can produce a meaningful dead-link finding. */
export function hasFileExtension(target: string): boolean {
  return /\.[a-z0-9]+$/i.test(stripTargetFragment(target));
}
