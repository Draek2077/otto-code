import { defaultMarkdownParser } from "@/components/markdown/parser";

export interface MarkdownSourceTextRun {
  text: string;
  start: number;
  end: number;
}

export interface MarkdownSourceFence {
  tokenIndex: number;
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  language: string | null;
  label: string;
}

interface SourceToken {
  type: string;
  map: [number, number] | null;
  content: string;
  info: string;
  children?: SourceToken[] | null;
}

/**
 * Maps renderer-visible inline runs and fenced blocks back to raw Markdown
 * offsets. The browser selection is merely a way to choose one of these
 * source-owned spans; it is never the persisted review anchor.
 */
export function collectMarkdownSourceMap(source: string): {
  textRuns: MarkdownSourceTextRun[];
  fences: MarkdownSourceFence[];
} {
  const lineOffsets = buildLineOffsets(source);
  const tokens = defaultMarkdownParser.parse(source, {}) as SourceToken[];
  const textRuns: MarkdownSourceTextRun[] = [];
  const fences: MarkdownSourceFence[] = [];
  for (const [tokenIndex, token] of tokens.entries()) {
    if (!token.map) continue;
    const start = lineOffsets[token.map[0]] ?? source.length;
    const end = lineOffsets[token.map[1]] ?? source.length;
    if (token.type === "inline" && token.children) {
      textRuns.push(...collectInlineRuns(source, start, end, token.children));
    }
    if (token.type === "fence") {
      const language = token.info.trim().split(/\s+/, 1)[0] || null;
      const contentStart = source.indexOf(token.content, start);
      fences.push({
        tokenIndex,
        start,
        end,
        contentStart: contentStart >= 0 ? contentStart : start,
        contentEnd: contentStart >= 0 ? contentStart + token.content.length : end,
        language,
        label: language === "mermaid" ? "Mermaid diagram" : `${language ?? "Code"} block`,
      });
    }
  }
  return { textRuns, fences };
}

function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") offsets.push(index + 1);
  }
  offsets.push(source.length);
  return offsets;
}

function collectInlineRuns(
  source: string,
  blockStart: number,
  blockEnd: number,
  children: readonly SourceToken[],
): MarkdownSourceTextRun[] {
  const block = source.slice(blockStart, blockEnd);
  const runs: MarkdownSourceTextRun[] = [];
  let cursor = 0;
  for (const child of children) {
    if (!isVisibleInlineText(child) || !child.content) continue;
    const index = block.indexOf(child.content, cursor);
    if (index < 0) continue;
    const start = blockStart + index;
    runs.push({ text: child.content, start, end: start + child.content.length });
    cursor = index + child.content.length;
  }
  return runs;
}

function isVisibleInlineText(token: SourceToken): boolean {
  return token.type === "text" || token.type === "code_inline";
}
