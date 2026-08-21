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
 * The quotes and escaping exist for the model, not the UI: they make the path
 * unambiguous when it contains spaces or other tokens the prose around it
 * could be confused with (`open "src/changed \"file\".ts" next` parses as one
 * path; without the quotes the agent cannot tell where the path ends).
 *
 * This used to be what picking a file inserted into the composer, so the user
 * saw the quoted form too. It is now a serialize-time detail: a picked file
 * becomes a removable `file_context` pill (see `removeFileMention`), and this
 * runs only on the fallback path, where the composer has no attachment scope
 * to put a pill in.
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

/**
 * Drop the `@query` the user was typing, leaving the prose around it intact.
 *
 * What picking a file does now: the path leaves the text entirely and arrives
 * as a pill, so the sentence reads as a sentence ("look at this and tell me
 * why") with the file attached beside it rather than spliced into it.
 */
export function removeFileMention(input: { text: string; mention: FileMentionRange }): string {
  return `${input.text.slice(0, input.mention.start)}${input.text.slice(input.mention.end)}`;
}
