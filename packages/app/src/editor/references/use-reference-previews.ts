import { useEffect, useState } from "react";
import type { HighlightToken } from "@otto-code/highlight";
import { trimLeadingTokens } from "@/editor/code-results/result-rows";
import { extensionFromPath, tokenizeToLines } from "@/utils/highlight-cache";
import { useSessionStore } from "@/stores/session-store";
import type { CodeReferencesGroup } from "./use-code-references";

/**
 * The source line behind each hit, so a results list reads as code rather than as
 * coordinates. A reference list without the line is a list of places to go and look -
 * which is most of the work the list was supposed to save.
 *
 * One read per FILE, not per hit: a file with twelve call sites is one read and twelve
 * slices. Reads are keyed by path and never repeated while the tab lives, because the
 * daemon already re-reads on its own terms and a results tab is a snapshot of an answer.
 *
 * Each line is tokenized from the WHOLE file, not from the line on its own: a call site
 * lifted out of context tokenizes as a fragment, and a fragment highlights wrong far more
 * often than it highlights nothing. The file is already in hand from the read, so this costs
 * one parse per file and nothing per hit.
 *
 * Previews are deliberately best-effort. A file that cannot be read (deleted since the
 * search, outside the workspace, binary) simply has no preview - the hit is still real and
 * still navigable, and failing the whole list over one unreadable file would be worse.
 * Highlighting is best-effort on top of that: an unsupported language or an oversized file
 * yields `tokens: null`, and the row falls back to plain mono text.
 */

export interface CodeLinePreview {
  /** The line, indentation stripped - a results list has no room for it. */
  text: string;
  /** Aligned with `text`, or null when the file could not be tokenized. */
  tokens: HighlightToken[] | null;
}

/** `line number → that line's preview`, for the lines actually referenced. */
export type PreviewsByPath = Record<string, Record<number, CodeLinePreview>>;

export function useReferencePreviews(input: {
  serverId: string;
  cwd: string;
  groups: readonly CodeReferencesGroup[];
  enabled: boolean;
}): PreviewsByPath {
  const { serverId, cwd, groups, enabled } = input;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [previews, setPreviews] = useState<PreviewsByPath>({});

  // The set of files to read, as a stable string: `groups` is a fresh array on every
  // provisional re-ask, and depending on it directly would re-read every file each time.
  const pathKey = groups.map((group) => group.path).join("\0");

  useEffect(() => {
    if (!enabled || client === null || cwd.length === 0 || groups.length === 0) {
      return;
    }
    let cancelled = false;

    const load = async (): Promise<void> => {
      for (const group of groups) {
        if (cancelled) {
          return;
        }
        // Skip what we already hold - a provisional result that grows adds files, it does
        // not change the ones already read.
        if (previews[group.path] !== undefined) {
          continue;
        }
        try {
          // `readTextFile`, not `readFile`: the latter hands back raw bytes and leaves the
          // decoding to the caller, which for a preview line is work the daemon has already
          // done once.
          const result = await client.readTextFile(cwd, group.path);
          if (cancelled) {
            continue;
          }
          const lines = result.content.split("\n");
          const tokenLines = tokenizeToLines(result.content, extensionFromPath(group.path));
          const wanted: Record<number, CodeLinePreview> = {};
          for (const hit of group.hits) {
            const text = lines[hit.line - 1];
            if (text === undefined) {
              continue;
            }
            const tokens = tokenLines?.[hit.line - 1];
            wanted[hit.line] = {
              text: text.trim(),
              tokens: tokens === undefined ? null : trimLeadingTokens(tokens),
            };
          }
          setPreviews((current) => ({ ...current, [group.path]: wanted }));
        } catch {
          // Best-effort; see the note above.
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
    // `previews` is read but deliberately not a dependency: including it would re-run this
    // effect on every file it loads, and the guard above already makes the work idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, cwd, enabled, pathKey]);

  return previews;
}
