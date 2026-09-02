import type { ParsedDiffFile } from "@otto-code/protocol/messages";

// Canvas layout is synchronous in the renderer. Keep its input below the size
// that can monopolize the UI thread before the first frame is painted.
export const MAX_DIFF_RENDER_LINES = 20_000;

export function exceedsDiffRenderBudget(files: readonly ParsedDiffFile[]): boolean {
  let lines = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      lines += hunk.lines.length;
      if (lines > MAX_DIFF_RENDER_LINES) return true;
    }
  }
  return false;
}
