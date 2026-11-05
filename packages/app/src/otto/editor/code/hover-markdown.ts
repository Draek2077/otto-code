/**
 * Structure recovery for hover content.
 *
 * Language servers do send structure - `textDocument/hover` returns markdown whose
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
 * A run that is nothing but one inline code span, and the code inside it.
 *
 * Not every server fences its signature. csharp-ls 0.16.0 - the release a .NET 8 host is pinned
 * to - emits the signature as a DOUBLE-backtick code span and no fence at all:
 * `` `` int Thing.Count `` ``. Read as prose that rendered uncoloured, and `plainProse`'s
 * single-backtick strip left the outer ticks behind, so a C# hover was a drab string in strange
 * quotes next to TypeScript's syntax-highlighted block. Same Otto, same renderer - only the shape
 * of the markdown differed.
 *
 * CommonMark allows any run length as the delimiter and strips one leading/trailing space, which
 * is exactly the form csharp-ls emits.
 */
const CODE_SPAN = /^(`+)([\s\S]+?)\1$/;

function asCodeSpan(text: string): string | null {
  const match = CODE_SPAN.exec(text.trim());
  if (match === null) {
    return null;
  }
  const inner = match[2].trim();
  // A span containing a backtick run of its own is not a simple signature; leave it as prose.
  return inner.length === 0 || inner.includes("`") ? null : inner;
}

/**
 * Split hover markdown into fenced code and prose runs, in order. Blank-only runs are
 * dropped so a fence surrounded by whitespace does not produce empty sections.
 *
 * An unterminated fence - servers do emit them - is treated as running to the end
 * rather than discarded, because the signature is usually the thing inside it.
 */
/**
 * Peel leading paragraphs that are wholly a code span off an unfenced run, leaving the rest as
 * one prose block.
 *
 * Only LEADING ones: a server that fences nothing puts its signature first and its documentation
 * after, and splitting the documentation on every blank line as well would scatter dividers
 * through a paragraph that was always meant to read as one.
 */
function splitUnfenced(text: string): HoverSegment[] {
  const segments: HoverSegment[] = [];
  let rest = text;

  for (;;) {
    const split = rest.search(/\n\s*\n/);
    const head = split === -1 ? rest : rest.slice(0, split);
    const span = asCodeSpan(head);
    if (span === null) {
      break;
    }
    segments.push({ kind: "code", language: "", text: span });
    if (split === -1) {
      return segments;
    }
    rest = rest.slice(split).replace(/^\s*\n\s*\n/, "");
  }

  if (rest.trim().length > 0) {
    segments.push({ kind: "prose", text: rest });
  }
  return segments;
}

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
      segments.push(...splitUnfenced(text));
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
  return (
    text
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1$2")
      // Any delimiter run, not just one backtick. The single-tick form left the outer ticks of a
      // ``double-backtick`` span sitting in the tooltip, which is what "strange quotes" was.
      .replace(/(`+)([\s\S]*?)\1/g, (_match, _ticks: string, inner: string) => inner.trim())
      .trim()
  );
}

/**
 * A filename the highlighter can pick a parser from. `highlightCode` keys off the
 * extension, so a fence's language tag has to become one - servers tag with language
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
