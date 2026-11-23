/**
 * GitHub alerts (`> [!NOTE]`, `> [!WARNING]`, …) for the shared markdown renderer.
 *
 * Rewrites at the token level, after block and inline parsing, for the same
 * reason `task-lists.ts` does: the marker is only an alert when it opens a real
 * blockquote, and `[!NOTE]` written inside a code fence or mid-sentence has to
 * stay literal text.
 *
 * The kind is attached to the `blockquote_open` token as an attribute, which
 * `tokensToAST` turns into `node.attributes` for the renderer's `blockquote`
 * rule to read. Nothing here decides what an alert looks like - this is the
 * parse half, and it is the half worth testing.
 */

export type GithubAlertKind = "note" | "tip" | "important" | "warning" | "caution";

/** The attribute the renderer reads off `blockquote_open`. */
export const ALERT_ATTRIBUTE = "data-otto-alert";

const ALERT_KINDS = new Set<string>(["note", "tip", "important", "warning", "caution"]);

// GitHub matches the marker case-insensitively and requires it to be the whole
// first line of the quote.
const ALERT_MARKER = /^\[!([A-Za-z]+)\][ \t]*$/;

interface AlertToken {
  type: string;
  content: string;
  children?: AlertToken[] | null;
  /**
   * markdown-it's own setter. Declared instead of the `attrs` array because
   * markdown-it types that array as `TokenAttribute[]`, which a hand-rolled
   * `[string, string][]` is not assignable to - and the setter is the supported
   * way to add one anyway.
   */
  attrSet?: (name: string, value: string) => void;
}

interface AlertCoreState {
  tokens: AlertToken[];
}

interface MarkdownItWithCoreRuler {
  core: {
    ruler: {
      push: (name: string, rule: (state: AlertCoreState) => void) => void;
    };
  };
}

export function parseAlertKind(text: string): GithubAlertKind | null {
  const match = ALERT_MARKER.exec(text.trim());
  if (!match) {
    return null;
  }
  const kind = match[1].toLowerCase();
  return ALERT_KINDS.has(kind) ? (kind as GithubAlertKind) : null;
}

function setAttribute(token: AlertToken, name: string, value: string): void {
  token.attrSet?.(name, value);
}

/**
 * Tag alert blockquotes and strip their marker line.
 *
 * The marker occupies the first text child plus the softbreak that follows it;
 * both go, or the alert body starts with a blank line.
 */
export function rewriteGithubAlertTokens(tokens: AlertToken[]): void {
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    if (
      tokens[index]?.type !== "blockquote_open" ||
      tokens[index + 1]?.type !== "paragraph_open" ||
      tokens[index + 2]?.type !== "inline"
    ) {
      continue;
    }
    const inline = tokens[index + 2];
    const first = inline.children?.[0];
    if (!first || first.type !== "text") {
      continue;
    }
    const kind = parseAlertKind(first.content);
    if (!kind) {
      continue;
    }
    setAttribute(tokens[index], ALERT_ATTRIBUTE, kind);

    const children = inline.children ?? [];
    children.shift();
    if (children[0]?.type === "softbreak") {
      children.shift();
    }
    // `content` is the raw source of the inline run; the renderer does not read
    // it once children exist, but a stale copy of the marker here would resurface
    // anywhere that falls back to it.
    inline.content = inline.content.replace(/^\[![A-Za-z]+\][ \t]*\r?\n?/, "");
  }
}

/** Registers the alert rewrite on a markdown-it parser and returns it. */
export function applyGithubAlerts<T extends MarkdownItWithCoreRuler>(parser: T): T {
  parser.core.ruler.push("otto_github_alerts", (state) => {
    rewriteGithubAlertTokens(state.tokens);
  });
  return parser;
}
