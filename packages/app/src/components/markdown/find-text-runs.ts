import { recoverMisnestedMarkdownFence } from "@/components/markdown/fence-recovery";
import { splitHtmlishMarkdown, type HtmlishOptions } from "@/components/markdown/html-ish";
import { defaultMarkdownParser } from "@/components/markdown/parser";

// The text a rendered document actually shows, in reading order.
//
// Find-in-preview needs this because the rendered view has nothing else to
// count: prose reflows, so there are no lines, and the render rules are handed
// one node's content at a time with no idea where in the document it sits.
// Indexing the runs up front is what lets the strip say "3/17" and mean the
// same thing it means over the code view.
//
// This walks the same fence recovery, the same html-ish split and the same
// markdown-it instance the renderer walks, so the runs collected here are the
// runs that get rendered. It stops at the token stream rather than going on to
// build the AST: everything between the two (`cleanupTokens`, `groupTextTokens`,
// `omitListItemParagraph`, `tokensToAST`) regroups and rewraps nodes without
// rewriting any node's content, so neither the set of runs nor their order can
// change. Stopping there is also what keeps this module loadable outside a
// React Native bundle - `react-native-markdown-display`'s entry point is JSX.

/**
 * Only the two fields this walk reads. Structural rather than markdown-it's own
 * `Token`, matching `annotation-locators.ts`: the package resolves to different
 * type shapes across this repo's build targets, and a walk that needs a type
 * and a string should not be the thing that breaks over it.
 */
interface MarkdownSourceToken {
  type: string;
  content: string;
  children?: MarkdownSourceToken[] | null;
}

/** Token types whose `content` the shared rules render as visible text. */
const TEXT_RUN_TYPES = new Set(["text", "code_inline"]);

function collectFromTokens(tokens: readonly MarkdownSourceToken[], runs: string[]): void {
  for (const token of tokens) {
    if (TEXT_RUN_TYPES.has(token.type) && token.content) {
      runs.push(token.content);
    }
    if (token.children && token.children.length > 0) {
      collectFromTokens(token.children, runs);
    }
  }
}

export interface RenderedTextRunOptions {
  text: string;
  /** Mirrors `MarkdownRenderer`'s own prop; false skips the html-ish split. */
  enableHtmlish: boolean;
  remoteImages?: HtmlishOptions["remoteImages"];
  /** Whether the document resolves workspace-relative image srcs. */
  hasWorkspaceImages?: boolean;
}

/**
 * Every visible text run of a rendered markdown document, in reading order.
 *
 * Two constructs are deliberately left out, and both are invisible at the
 * moment the index is built:
 *
 * - A `<details>` body, which is collapsed until the reader opens it. Counting
 *   text nobody can see would make the match total disagree with the tinted
 *   hits on screen, which is worse than not finding it.
 * - Fenced and indented code blocks, which render through the syntax
 *   highlighter rather than the shared `text` rule, so a range handed to them
 *   would have nowhere to land.
 */
export function collectRenderedTextRuns({
  text,
  enableHtmlish,
  remoteImages,
  hasWorkspaceImages = false,
}: RenderedTextRunOptions): string[] {
  const recovered = recoverMisnestedMarkdownFence(text);
  const parts = enableHtmlish
    ? splitHtmlishMarkdown(recovered, {
        remoteImages,
        localImages: hasWorkspaceImages ? "workspace" : "off",
      })
    : [{ kind: "markdown" as const, text: recovered }];

  const runs: string[] = [];
  for (const part of parts) {
    if (part.kind !== "markdown" || part.text.length === 0) {
      continue;
    }
    collectFromTokens(defaultMarkdownParser.parse(part.text, {}) as MarkdownSourceToken[], runs);
  }
  return runs;
}
