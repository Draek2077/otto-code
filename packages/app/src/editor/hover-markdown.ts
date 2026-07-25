/**
 * Structure recovery for hover content.
 *
 * Language servers do send structure — `textDocument/hover` returns markdown whose
 * fenced blocks are the signature and whose loose text is the documentation. The first
 * version of this feature flattened all of it into one `textContent`, which is why a
 * hover read as an undifferentiated blob of more code. This module gets the structure
 * back so the renderer can treat a signature and a paragraph differently.
 *
 * Pure on purpose: `editor-core.ts` is bundled into the native webview and cannot be
 * unit-tested in node, so the parsing lives here where it can.
 */

export interface HoverCodeSegment {
  kind: "code";
  /** The fence's language tag, lower-cased; empty when the fence had none. */
  language: string;
  text: string;
}

export interface HoverProseSegment {
  kind: "prose";
  text: string;
}

export type HoverSegment = HoverCodeSegment | HoverProseSegment;

const FENCE = /^\s*```(\S*)\s*$/;

/**
 * Split hover markdown into fenced code and prose runs, in order. Blank-only runs are
 * dropped so a fence surrounded by whitespace does not produce empty sections.
 *
 * An unterminated fence — servers do emit them — is treated as running to the end
 * rather than discarded, because the signature is usually the thing inside it.
 */
export function parseHoverMarkdown(markdown: string): HoverSegment[] {
  const segments: HoverSegment[] = [];
  let buffer: string[] = [];
  let fenceLanguage: string | null = null;

  const flush = (): void => {
    const text = buffer.join("\n").replace(/^\n+|\n+$/g, "");
    buffer = [];
    if (text.trim().length === 0) {
      return;
    }
    if (fenceLanguage === null) {
      segments.push({ kind: "prose", text });
      return;
    }
    segments.push({ kind: "code", language: fenceLanguage, text });
  };

  for (const line of markdown.split("\n")) {
    const fence = FENCE.exec(line);
    if (fence === null) {
      buffer.push(line);
      continue;
    }
    // A fence both closes the run before it and opens the next one.
    flush();
    fenceLanguage = fenceLanguage === null ? fence[1].toLowerCase() : null;
  }
  flush();

  return segments;
}

/**
 * Strip the inline markers servers use inside prose. Emphasis and inline code carry no
 * extra meaning in a one-glance tooltip, and leaving the raw asterisks in is worse than
 * dropping them.
 */
export function plainProse(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/**
 * A filename the highlighter can pick a parser from. `highlightCode` keys off the
 * extension, so a fence's language tag has to become one — servers tag with language
 * names (`typescript`), not extensions.
 */
export function filenameForHoverLanguage(language: string): string | null {
  const extension = HOVER_LANGUAGE_EXTENSIONS[language];
  return extension === undefined ? null : `hover.${extension}`;
}

const HOVER_LANGUAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  typescript: "ts",
  ts: "ts",
  typescriptreact: "tsx",
  tsx: "tsx",
  javascript: "js",
  js: "js",
  javascriptreact: "jsx",
  jsx: "jsx",
  python: "py",
  py: "py",
  csharp: "cs",
  "c#": "cs",
  cs: "cs",
  html: "html",
  css: "css",
  json: "json",
  rust: "rs",
  rs: "rs",
  go: "go",
  java: "java",
  ruby: "rb",
  php: "php",
  sh: "sh",
  bash: "sh",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
};
