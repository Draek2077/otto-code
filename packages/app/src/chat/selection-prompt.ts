export const CHAT_SELECTION_ACTIONS = ["explain", "contest", "research", "complete"] as const;

export type ChatSelectionAction = (typeof CHAT_SELECTION_ACTIONS)[number];

/**
 * Tidies text selected from the rendered transcript. Browsers report
 * non-breaking spaces, CRLF, and trailing whitespace from the DOM layout, none
 * of which the author wrote. Null when nothing quotable remains.
 */
export function normalizeChatSelection(text: string): string | null {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function quoteAsMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/**
 * The instruction leads so a queued row's one-line preview names the action,
 * and the selection follows as a Markdown quote so the model can tell the
 * user's words from the text they are asking about.
 */
export function buildChatSelectionPrompt(input: {
  instruction: string;
  selection: string;
}): string | null {
  const selection = normalizeChatSelection(input.selection);
  if (!selection) return null;
  return `${input.instruction.trim()}\n\n${quoteAsMarkdown(selection)}`;
}
