import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CheckoutGitFileError,
  GitBlameCommit,
  GitFileHistoryEntry,
} from "@otto-code/protocol/messages";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { useSessionStore } from "@/stores/session-store";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import { parseUnifiedDiff, type DiffLine } from "@/utils/tool-call-parsers";
import { highlightDiffLines } from "@/utils/diff-highlight";

/**
 * Data plumbing for the git file-history pane. Everything here is a plain
 * imperative fetch against the daemon's `checkout.git.get_file_*` RPCs — these
 * are one-shot reads with no push updates, so there is no subscription or
 * replica query to model.
 */

/** A line range to scope history to, or null for the whole file. */
export interface FileHistoryRange {
  startLine: number;
  endLine: number;
}

const HISTORY_PAGE_SIZE = 40;
/**
 * Ceiling on the blame window backing the diff gutter. A diff can legitimately
 * span a whole large file (a reformat, a generated file), and blaming thousands
 * of lines to annotate a gutter nobody scrolls to is not worth the daemon time —
 * past this, the far end of the diff simply carries no annotation.
 */
const BLAME_MAX_GUTTER_LINES = 2000;

/** Wire errors carry a kind; turn one into something a person can read. */
function describeFileError(error: CheckoutGitFileError, notARepoLabel: string): string {
  switch (error.kind) {
    case "not_git_repo":
      return notARepoLabel;
    case "invalid_path":
    case "git_failed":
      return error.detail;
  }
}

interface UseFileHistoryInput {
  serverId: string;
  cwd: string;
  path: string;
  range: FileHistoryRange | null;
  /** Skip fetching while this view isn't the one being shown. */
  enabled: boolean;
  /**
   * Change to refetch from the top. These are one-shot reads with no push
   * channel — a repo can gain commits under an open pane and nothing would say
   * so — so refreshing has to be something the caller can ask for.
   */
  reloadToken?: number;
  notARepoLabel: string;
}

export interface FileHistoryState {
  entries: GitFileHistoryEntry[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMore: () => void;
}

export function useFileHistory(input: UseFileHistoryInput): FileHistoryState {
  const { serverId, cwd, path, range, enabled, reloadToken = 0, notARepoLabel } = input;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [entries, setEntries] = useState<GitFileHistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped to request the next page; also the guard that drops a response
  // arriving after the scope changed under it.
  const [page, setPage] = useState(0);

  const rangeKey = range ? `${range.startLine}-${range.endLine}` : "";
  useEffect(() => {
    setEntries([]);
    setHasMore(false);
    setPage(0);
    setError(null);
  }, [cwd, path, rangeKey, reloadToken]);

  useEffect(() => {
    if (!enabled || !client) return;
    let active = true;
    const offset = page * HISTORY_PAGE_SIZE;
    if (offset === 0) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    const load = async () => {
      try {
        const payload = await client.checkoutGitFileHistory(cwd, {
          path,
          limit: HISTORY_PAGE_SIZE,
          offset,
          ...(range ? { startLine: range.startLine, endLine: range.endLine } : {}),
        });
        if (!active) return;
        if (payload.error) {
          setError(describeFileError(payload.error, notARepoLabel));
          return;
        }
        setError(null);
        setEntries((previous) =>
          offset === 0 ? payload.entries : [...previous, ...payload.entries],
        );
        setHasMore(payload.hasMore);
      } catch (caught) {
        if (active) setError(getErrorMessage(caught));
      } finally {
        if (active) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
    // `range` is compared through rangeKey: a fresh object with the same numbers
    // must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, cwd, path, rangeKey, enabled, page, reloadToken, notARepoLabel]);

  const loadMore = useCallback(() => setPage((current) => current + 1), []);

  return { entries, hasMore, loading, loadingMore, error, loadMore };
}

export interface FileOriginState {
  entry: GitFileHistoryEntry | null;
  loading: boolean;
  error: string | null;
}

/** The commit that first added the file — a single cheap query, loaded once. */
export function useFileOrigin(input: {
  serverId: string;
  cwd: string;
  path: string;
  enabled: boolean;
  notARepoLabel: string;
}): FileOriginState {
  const { serverId, cwd, path, enabled, notARepoLabel } = input;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [entry, setEntry] = useState<GitFileHistoryEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !client) return;
    let active = true;
    setLoading(true);
    const load = async () => {
      try {
        const payload = await client.checkoutGitFileOrigin(cwd, { path });
        if (!active) return;
        if (payload.error) {
          setError(describeFileError(payload.error, notARepoLabel));
          setEntry(null);
          return;
        }
        setError(null);
        setEntry(payload.entry);
      } catch (caught) {
        if (active) setError(getErrorMessage(caught));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [client, cwd, path, enabled, notARepoLabel]);

  return { entry, loading, error };
}

export interface FileCommitDiffState {
  diffLines: DiffLine[];
  /**
   * The daemon's parsed + highlighted form of the same diff, when it parsed.
   * Preferred for rendering because it carries hunk coordinates, which is what
   * makes a line-number gutter (and therefore gutter blame) possible at all.
   */
  file: ParsedDiffFile | null;
  /** The file's previous revision — the left-hand side of this comparison. */
  previousSha: string | null;
  previousPath: string | null;
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY_DIFF_RESULT = {
  diff: "",
  file: null as ParsedDiffFile | null,
  previousSha: null as string | null,
  previousPath: null as string | null,
  truncated: false,
};

/**
 * The change one revision made to one file.
 *
 * The daemon compares this revision against the file's *previous revision*, so
 * `path` must be the file's name at this commit (history entries carry it) and
 * the response tells us which revision it ended up comparing against — that is
 * the honest label for the diff's left-hand side, and it is not always the
 * commit's parent.
 */
export function useFileCommitDiff(input: {
  serverId: string;
  cwd: string;
  path: string;
  sha: string | null;
  /** Re-diff with `-w`, so a reformat stops drowning the real change. */
  ignoreWhitespace?: boolean;
  notARepoLabel: string;
}): FileCommitDiffState {
  const { serverId, cwd, path, sha, ignoreWhitespace = false, notARepoLabel } = input;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [result, setResult] = useState(EMPTY_DIFF_RESULT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !sha) {
      setResult(EMPTY_DIFF_RESULT);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    const load = async () => {
      try {
        const payload = await client.checkoutGitFileCommitDiff(cwd, {
          path,
          sha,
          ignoreWhitespace,
        });
        if (!active) return;
        if (payload.error) {
          setError(describeFileError(payload.error, notARepoLabel));
          setResult(EMPTY_DIFF_RESULT);
          return;
        }
        setError(null);
        setResult({
          diff: payload.diff,
          // One file was requested, so one file comes back.
          file: payload.structured?.[0] ?? null,
          previousSha: payload.previousSha ?? null,
          previousPath: payload.previousPath ?? null,
          truncated: payload.truncated,
        });
      } catch (caught) {
        if (active) setError(getErrorMessage(caught));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [client, cwd, path, sha, ignoreWhitespace, notARepoLabel]);

  // Only needed when the daemon could not structure the diff; the raw text is
  // the fallback rendering path.
  const diffLines = useMemo(
    () =>
      result.file || !result.diff ? [] : highlightDiffLines(parseUnifiedDiff(result.diff), path),
    [result.file, result.diff, path],
  );

  return {
    diffLines,
    file: result.file,
    previousSha: result.previousSha,
    previousPath: result.previousPath,
    truncated: result.truncated,
    loading,
    error,
  };
}

const EMPTY_BLAME = new Map<number, GitBlameCommit>();

/**
 * Blame for the span of lines a diff actually shows, resolved **at the revision
 * being viewed**, keyed by post-image line number so the gutter can look each
 * line up directly.
 *
 * Blaming at the revision rather than at HEAD is what makes the annotation true:
 * the diff's line numbers describe the file as it stood at that commit, and
 * blaming the working tree instead would label them with whoever touched those
 * line *positions* since — a different file's authorship, silently.
 *
 * Only the shown span is requested. Blame is expensive on a large file, and a
 * diff usually touches a few hunks in the middle of one.
 */
export function useRevisionBlame(input: {
  serverId: string;
  cwd: string;
  path: string;
  sha: string | null;
  /** Post-image line span to cover; null when there is nothing to annotate. */
  span: { startLine: number; endLine: number } | null;
  enabled: boolean;
  notARepoLabel: string;
}): ReadonlyMap<number, GitBlameCommit> {
  const { serverId, cwd, path, sha, span, enabled } = input;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [byLine, setByLine] = useState<ReadonlyMap<number, GitBlameCommit>>(EMPTY_BLAME);

  const startLine = span?.startLine ?? 0;
  const endLine = span?.endLine ?? 0;

  useEffect(() => {
    if (!enabled || !client || !sha || startLine === 0) {
      setByLine(EMPTY_BLAME);
      return;
    }
    const lineCount = Math.min(BLAME_MAX_GUTTER_LINES, endLine - startLine + 1);
    if (lineCount <= 0) {
      setByLine(EMPTY_BLAME);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const payload = await client.checkoutGitFileBlame(cwd, {
          path,
          sha,
          startLine,
          lineCount,
        });
        if (!active) return;
        if (payload.error) {
          // Blame is an annotation, not the content. A file git cannot blame
          // (yet-uncommitted, or a revision it cannot reach) should cost the
          // gutter, not the diff — so this failure stays silent.
          setByLine(EMPTY_BLAME);
          return;
        }
        const commits = new Map(payload.commits.map((commit) => [commit.sha, commit]));
        const next = new Map<number, GitBlameCommit>();
        for (const line of payload.lines) {
          const commit = commits.get(line.sha);
          if (commit) {
            next.set(line.line, commit);
          }
        }
        setByLine(next);
      } catch {
        if (active) setByLine(EMPTY_BLAME);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [client, cwd, path, sha, startLine, endLine, enabled]);

  return byLine;
}
