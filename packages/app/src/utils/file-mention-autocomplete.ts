export interface FileMentionRange {
  start: number;
  end: number;
  query: string;
}

interface FindActiveFileMentionInput {
  text: string;
  cursorIndex: number;
}

interface ApplyFileMentionReplacementInput {
  text: string;
  mention: FileMentionRange;
  relativePath: string;
}

const INVALID_MENTION_QUERY_CHARS = /[\s\n\r\t"']/;

export function findActiveFileMention(input: FindActiveFileMentionInput): FileMentionRange | null {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const beforeCursor = input.text.slice(0, clampedCursor);

  for (
    let atIndex = beforeCursor.lastIndexOf("@");
    atIndex >= 0;
    atIndex = atIndex === 0 ? -1 : beforeCursor.lastIndexOf("@", atIndex - 1)
  ) {
    const query = beforeCursor.slice(atIndex + 1);
    if (INVALID_MENTION_QUERY_CHARS.test(query)) {
      continue;
    }
    return {
      start: atIndex,
      end: clampedCursor,
      query,
    };
  }

  return null;
}

/**
 * The quoted, escaped form of a workspace-relative path.
 *
 * This is the agent-facing representation of a file mention, and it is
 * deliberately the same text the user sees in the composer and the sent
 * message bubble. Picking a file inserts `"src/components/chat.tsx"` verbatim;
 * there is no separate display form. Keeping one form end-to-end preserves
 * WYSIWYG: what the user typed is exactly what the agent receives, and copy,
 * rewind, and history recall never reintroduce a form the user has not seen.
 *
 * The quotes and escaping exist for the model, not the UI: they make the path
 * unambiguous when it contains spaces or other tokens the prose around it
 * could be confused with (`open "src/changed \"file\".ts" next` parses as one
 * path; without the quotes the agent cannot tell where the path ends).
 *
 * If a richer composer ever represents mentions as structured tokens, this is
 * the function to apply at serialize time - and only then - so the token's
 * display form can stay clean.
 */
export function formatQuotedFileMentionPath(relativePath: string): string {
  const safePath = relativePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${safePath}"`;
}

export function applyFileMentionReplacement(input: ApplyFileMentionReplacementInput): string {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  return `${before}${formatQuotedFileMentionPath(input.relativePath)}${after}`;
}
