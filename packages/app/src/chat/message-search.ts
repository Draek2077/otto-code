import type { StreamItem } from "@/types/stream";

export interface ChatMessageSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export interface ChatMessageSearchResult {
  itemId: string;
  start: number;
  end: number;
}

/** The open Find strip's query and the occurrence the reader is currently on. */
export interface ChatMessageSearchState {
  query: string;
  options: ChatMessageSearchOptions;
  activeResult: ChatMessageSearchResult | null;
}

/**
 * Search only the conversational record. Tool calls, thinking, and activity
 * rows are deliberately outside this first version's scope.
 */
export function findChatMessageMatches(
  items: readonly StreamItem[],
  query: string,
  options: ChatMessageSearchOptions,
): ChatMessageSearchResult[] {
  if (!query) return [];

  const expression = buildSearchExpression(query, options);
  if (!expression) return [];

  const results: ChatMessageSearchResult[] = [];
  for (const item of items) {
    if (item.kind !== "user_message" && item.kind !== "assistant_message") continue;
    expression.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(item.text)) !== null) {
      results.push({ itemId: item.id, start: match.index, end: match.index + match[0].length });
      // A user-entered expression may match the empty string. Advancing keeps
      // Find finite and follows the browser's normal global-regexp behavior.
      if (match[0].length === 0) expression.lastIndex += 1;
    }
  }
  return results;
}

function buildSearchExpression(query: string, options: ChatMessageSearchOptions): RegExp | null {
  const source = options.regexp ? query : escapeRegExp(query);
  const wholeWordSource = options.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(wholeWordSource, options.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
