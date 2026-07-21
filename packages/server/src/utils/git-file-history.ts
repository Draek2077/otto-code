/**
 * Local-git investigation primitives for a single file (or a line range within
 * it): commit history, the per-commit patch, blame, and the commit that first
 * introduced the file.
 *
 * Deliberately **local git only** — nothing here talks to a hosting provider,
 * so it works in a repo with no remote and no GitHub/Bitbucket connection. Keep
 * it out of the forge layer (`services/git-hosting/`).
 *
 * Also note there is **no per-provider rollout** for this subsystem, unlike most
 * capabilities in this repo: it is provider-neutral by construction because it
 * is git, not an agent. If you came here looking for the per-provider adapter,
 * there isn't one and there shouldn't be.
 */

import { runGitCommand } from "./run-git-command.js";

const READ_ONLY_GIT_ENV = {
  GIT_OPTIONAL_LOCKS: "0",
} as const;

/** ASCII record/unit separators — safe framing for `git log --format`. */
const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

const HISTORY_TIMEOUT_MS = 60_000;
const BLAME_TIMEOUT_MS = 120_000;
const PATCH_MAX_BYTES = 2 * 1024 * 1024; // 2MB

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 500;
/** Blame is expensive on big files, so it is always paged, never whole-file. */
export const DEFAULT_BLAME_PAGE_LINES = 500;
export const MAX_BLAME_PAGE_LINES = 2000;

export class InvalidGitFilePathError extends Error {
  readonly code = "INVALID_GIT_FILE_PATH";

  constructor(readonly path: string) {
    super(`Invalid repo-relative path: ${path}`);
    this.name = "InvalidGitFilePathError";
  }
}

/**
 * Reject absolute paths and anything that walks out of the repo. Mirrors
 * `assertRepoRelativeCommitPaths` in checkout-git.ts; the pathspec always goes
 * after `--` so a leading dash can never be read as an option.
 */
export function assertRepoRelativeFilePath(path: string): void {
  const isAbsolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(path);
  const escapesRepo = path.split(/[\\/]/).includes("..");
  if (path.length === 0 || isAbsolute || escapesRepo) {
    throw new InvalidGitFilePathError(path);
  }
}

/**
 * A commit that touched the file. `path` is the file's name **at that commit**,
 * which differs from the requested path across a rename — always diff against
 * this one, not the current name.
 */
export interface GitFileHistoryEntry {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  /** Unix seconds. */
  authoredAt: number;
  committerName: string;
  committedAt: number;
  path: string;
  /** Set when this commit renamed the file; the name it had before. */
  previousPath?: string;
  /** Single-letter git status for this file in this commit (A/M/D/R/C). */
  changeKind?: string;
  /** True when this commit has more than one parent. */
  isMerge: boolean;
  /**
   * Parent object names. A diff view names the left-hand revision from this
   * rather than printing `<sha>^`; empty means a root commit, which is the
   * honest "this is where the file appeared" signal.
   */
  parentShas: string[];
}

export interface GitFileHistoryResult {
  entries: GitFileHistoryEntry[];
  /** True when more entries exist past `offset + entries.length`. */
  hasMore: boolean;
}

export interface GitFileHistoryInput {
  path: string;
  limit?: number;
  offset?: number;
  /**
   * Restrict the history to a line range (`git log -L`). Line numbers are
   * 1-based and inclusive. Rename-following is git's own for this mode.
   */
  startLine?: number;
  endLine?: number;
}

const HISTORY_FORMAT = [
  `${RECORD_SEP}%H`,
  "%h",
  "%an",
  "%ae",
  "%at",
  "%cn",
  "%ct",
  "%P",
  "%s",
  `%b${FIELD_SEP}`,
].join(FIELD_SEP);

interface ParsedHistoryRecord {
  entry: GitFileHistoryEntry;
  /** Raw `--name-status` text trailing the formatted header, if any. */
  nameStatus: string;
}

function parseHistoryRecords(stdout: string, fallbackPath: string): ParsedHistoryRecord[] {
  const records: ParsedHistoryRecord[] = [];
  for (const chunk of stdout.split(RECORD_SEP)) {
    if (chunk.trim().length === 0) continue;
    const fields = chunk.split(FIELD_SEP);
    if (fields.length < 10) continue;
    const [
      sha,
      shortSha,
      authorName,
      authorEmail,
      authoredAt,
      committerName,
      committedAt,
      parents,
      subject,
      body,
    ] = fields as [string, string, string, string, string, string, string, string, string, string];
    const trailer = fields.slice(10).join(FIELD_SEP);
    const parentShas = parents.trim().split(/\s+/).filter(Boolean);
    records.push({
      entry: {
        sha: sha.trim(),
        shortSha: shortSha.trim(),
        subject,
        body: body.trimEnd(),
        authorName,
        authorEmail,
        authoredAt: Number.parseInt(authoredAt, 10) || 0,
        committerName,
        committedAt: Number.parseInt(committedAt, 10) || 0,
        path: fallbackPath,
        isMerge: parentShas.length > 1,
        parentShas,
      },
      nameStatus: trailer,
    });
  }
  return records;
}

/**
 * Pull the file's name at this commit out of the `--name-status` trailer.
 * A rename line is `R100\<tab>old\<tab>new`; everything else is `X\<tab>path`.
 */
function applyNameStatus(entry: GitFileHistoryEntry, nameStatus: string): void {
  for (const line of nameStatus.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("\t")) continue;
    const parts = trimmed.split("\t");
    const status = parts[0] ?? "";
    if (!status) continue;
    entry.changeKind = status[0];
    if ((status.startsWith("R") || status.startsWith("C")) && parts[2]) {
      entry.previousPath = parts[1];
      entry.path = parts[2];
    } else if (parts[1]) {
      entry.path = parts[1];
    }
    return;
  }
}

/**
 * Resolve every record's `path` to the file's name *at that commit*, walking
 * newest → oldest and carrying the name backwards across renames.
 *
 * `--name-status` is empty for merge commits, so a merge record has nothing to
 * read its own name from. Left to itself it would keep the requested (current)
 * name, and any diff aimed at that name would miss on the far side of a rename
 * — which is how a merge ends up showing an empty or wrong change set.
 */
function resolvePathsAlongWalk(records: ParsedHistoryRecord[], requestedPath: string): void {
  let pathAtWalk = requestedPath;
  for (const record of records) {
    if (record.nameStatus) {
      applyNameStatus(record.entry, record.nameStatus);
      // Older commits know the file by the name it had *before* this rename.
      pathAtWalk = record.entry.previousPath ?? record.entry.path;
    } else {
      record.entry.path = pathAtWalk;
    }
  }
}

function clampLimit(requested: number | undefined): number {
  const limit = requested ?? DEFAULT_HISTORY_LIMIT;
  return Math.max(1, Math.min(MAX_HISTORY_LIMIT, limit));
}

/**
 * Commits that touched `path`, newest first.
 *
 * Whole-file mode uses `--follow`, which is the entire point of this tool:
 * without it the history stops dead at the rename, and a rename is exactly when
 * someone reaches for file history. Line-range mode uses `git log -L`, which
 * does its own rename tracking and cannot be combined with `--follow`.
 */
export async function getFileHistory(
  cwd: string,
  input: GitFileHistoryInput,
): Promise<GitFileHistoryResult> {
  assertRepoRelativeFilePath(input.path);
  const limit = clampLimit(input.limit);
  const offset = Math.max(0, input.offset ?? 0);
  // Ask for one extra to answer hasMore without a second count query.
  const probe = limit + 1;

  const hasRange =
    typeof input.startLine === "number" &&
    typeof input.endLine === "number" &&
    input.startLine > 0 &&
    input.endLine >= input.startLine;

  const args = hasRange
    ? [
        "log",
        `--format=${HISTORY_FORMAT}`,
        `--max-count=${probe}`,
        `--skip=${offset}`,
        // `-s` suppresses the patch that -L implies; we only want the commit list.
        "-s",
        `-L${input.startLine},${input.endLine}:${input.path}`,
      ]
    : [
        "log",
        "--follow",
        "-M",
        `--format=${HISTORY_FORMAT}`,
        "--name-status",
        `--max-count=${probe}`,
        `--skip=${offset}`,
        "--",
        input.path,
      ];

  const { stdout } = await runGitCommand(args, {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    timeout: HISTORY_TIMEOUT_MS,
  });

  const records = parseHistoryRecords(stdout, input.path);
  resolvePathsAlongWalk(records, input.path);

  const hasMore = records.length > limit;
  return {
    entries: records.slice(0, limit).map((record) => record.entry),
    hasMore,
  };
}

export interface GitFileCommitDiffInput {
  path: string;
  sha: string;
  ignoreWhitespace?: boolean;
}

export interface GitFileCommitDiffResult {
  diff: string;
  truncated: boolean;
  /**
   * The file's previous revision — the diff's left-hand side. Absent when this
   * revision has no predecessor, i.e. the commit that created the file.
   */
  previousSha?: string;
  previousPath?: string;
}

/** One revision of one file: the commit, and the name the file had in it. */
interface FileRevision {
  sha: string;
  path: string;
}

/**
 * The revision of this file immediately preceding `sha` — the commit before it
 * that actually touched the file, and the name the file had there.
 *
 * Deliberately a second walk rather than something the client passes in: the
 * client only knows the page of history it has loaded, so the last row of a page
 * would have no predecessor and would render as if the file began there.
 */
async function findPreviousFileRevision(
  cwd: string,
  input: { path: string; sha: string },
): Promise<FileRevision | null> {
  const { stdout } = await runGitCommand(
    [
      "log",
      "--follow",
      "-M",
      `--format=${HISTORY_FORMAT}`,
      "--name-status",
      "--max-count=2",
      input.sha,
      "--",
      input.path,
    ],
    { cwd, envOverlay: READ_ONLY_GIT_ENV, timeout: HISTORY_TIMEOUT_MS },
  );

  const records = parseHistoryRecords(stdout, input.path);
  resolvePathsAlongWalk(records, input.path);
  // Record 0 is `sha` itself; record 1 is the revision it changed.
  const previous = records[1];
  return previous ? { sha: previous.entry.sha, path: previous.entry.path } : null;
}

const SHA_PATTERN = /^[0-9a-fA-F]{4,64}$/;

export class InvalidGitRevisionError extends Error {
  readonly code = "INVALID_GIT_REVISION";

  constructor(readonly revision: string) {
    super(`Invalid git revision: ${revision}`);
    this.name = "InvalidGitRevisionError";
  }
}

/**
 * Only accept object names here. The client always has a sha from a history
 * entry, so there is no reason to let arbitrary revision syntax (`HEAD@{...}`,
 * `..`, `^{/regex}`) reach the command line.
 */
export function assertCommitSha(sha: string): void {
  if (!SHA_PATTERN.test(sha)) {
    throw new InvalidGitRevisionError(sha);
  }
}

/**
 * What one revision did to one file, as a unified diff.
 *
 * This compares the file's **previous revision against this one, blob to blob**
 * — it is not the commit's own patch narrowed to a pathspec. That distinction is
 * the whole correctness story here: git applies a pathspec *before* rename
 * detection, so `git show <sha> -- <newname>` across a rename reports the file
 * as brand new (whole file added) instead of showing the handful of lines that
 * actually changed. Comparing the two blobs directly sidesteps it, and as a
 * bonus gives merge commits a meaningful diff (what the merge did to this file)
 * where `git show` on a merge yields nothing at all.
 */
export async function getFileCommitDiff(
  cwd: string,
  input: GitFileCommitDiffInput,
): Promise<GitFileCommitDiffResult> {
  assertRepoRelativeFilePath(input.path);
  assertCommitSha(input.sha);

  const whitespaceArgs = input.ignoreWhitespace ? ["-w"] : [];
  const previous = await findPreviousFileRevision(cwd, input);

  if (previous) {
    // `<rev>:./<path>` resolves the path relative to cwd, matching how the
    // pathspecs elsewhere in this file are interpreted; bare `<rev>:<path>`
    // would be repo-root-relative and diverge whenever cwd is a subdirectory.
    const result = await runGitCommand(
      [
        "diff",
        ...whitespaceArgs,
        `${previous.sha}:./${previous.path}`,
        `${input.sha}:./${input.path}`,
      ],
      {
        cwd,
        envOverlay: READ_ONLY_GIT_ENV,
        maxOutputBytes: PATCH_MAX_BYTES,
        timeout: HISTORY_TIMEOUT_MS,
        // A revision whose blob is missing — the commit deleted the file — exits
        // 128. That is a legitimate revision to inspect, so fall through to the
        // commit's own patch rather than failing the request.
        acceptExitCodes: [0, 1, 128],
      },
    );
    if (result.exitCode !== 128) {
      return {
        diff: result.stdout,
        truncated: result.truncated,
        previousSha: previous.sha,
        previousPath: previous.path,
      };
    }
  }

  const result = await runGitCommand(
    ["show", "--format=", "--patch", "-M", ...whitespaceArgs, input.sha, "--", input.path],
    {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      maxOutputBytes: PATCH_MAX_BYTES,
      timeout: HISTORY_TIMEOUT_MS,
    },
  );

  return { diff: result.stdout, truncated: result.truncated };
}

/** One source line and the commit that last touched it. */
export interface GitBlameLine {
  line: number;
  sha: string;
  /**
   * The line's number in the commit that introduced it — differs from `line`
   * when the surrounding file moved.
   */
  originalLine: number;
}

/** Commit metadata referenced by blame lines, deduped by sha. */
export interface GitBlameCommit {
  sha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  authorEmail: string;
  authoredAt: number;
  /** The file's name in this commit, when blame reports it. */
  path?: string;
}

export interface GitBlameResult {
  lines: GitBlameLine[];
  commits: GitBlameCommit[];
  startLine: number;
  /** Last line actually blamed; equals startLine - 1 when the range was empty. */
  endLine: number;
  /** True when the requested range ran past the end of the file. */
  reachedEndOfFile: boolean;
}

export interface GitBlameInput {
  path: string;
  /** 1-based, inclusive. Defaults to the first page. */
  startLine?: number;
  lineCount?: number;
  /** Blame at a specific commit instead of the working tree. */
  sha?: string;
}

interface BlameParseState {
  commits: Map<string, GitBlameCommit>;
  lines: GitBlameLine[];
}

const BLAME_HEADER_PATTERN = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/;

/**
 * Parse `git blame --porcelain`. Commit metadata is emitted once per sha and
 * omitted on later lines from the same commit, which is precisely why the
 * result carries a separate commit dictionary instead of inlining author info
 * on every line.
 */
export function parseBlamePorcelain(stdout: string): BlameParseState {
  const commits = new Map<string, GitBlameCommit>();
  const lines: GitBlameLine[] = [];
  let current: string | null = null;

  for (const raw of stdout.split("\n")) {
    const header = BLAME_HEADER_PATTERN.exec(raw);
    if (header) {
      const [, sha, originalLine, finalLine] = header as unknown as [
        string,
        string,
        string,
        string,
      ];
      current = sha;
      if (!commits.has(sha)) {
        commits.set(sha, {
          sha,
          shortSha: sha.slice(0, 8),
          summary: "",
          authorName: "",
          authorEmail: "",
          authoredAt: 0,
        });
      }
      lines.push({
        line: Number.parseInt(finalLine, 10) || 0,
        sha,
        originalLine: Number.parseInt(originalLine, 10) || 0,
      });
      continue;
    }
    if (!current || raw.startsWith("\t")) {
      continue;
    }
    const commit = commits.get(current);
    if (!commit) continue;
    const spaceIndex = raw.indexOf(" ");
    const key = spaceIndex === -1 ? raw : raw.slice(0, spaceIndex);
    const value = spaceIndex === -1 ? "" : raw.slice(spaceIndex + 1);
    switch (key) {
      case "author":
        commit.authorName = value;
        break;
      case "author-mail":
        commit.authorEmail = value.replace(/^<|>$/g, "");
        break;
      case "author-time":
        commit.authoredAt = Number.parseInt(value, 10) || 0;
        break;
      case "summary":
        commit.summary = value;
        break;
      case "filename":
        commit.path = value;
        break;
      default:
        break;
    }
  }

  return { commits, lines };
}

/**
 * Blame a page of lines. Always paged: blaming a large file whole blocks the
 * daemon for seconds, so callers walk the file a page at a time and the range
 * is clamped here rather than trusted.
 */
export async function getFileBlame(cwd: string, input: GitBlameInput): Promise<GitBlameResult> {
  assertRepoRelativeFilePath(input.path);
  if (input.sha !== undefined) {
    assertCommitSha(input.sha);
  }

  const startLine = Math.max(1, input.startLine ?? 1);
  const lineCount = Math.max(
    1,
    Math.min(MAX_BLAME_PAGE_LINES, input.lineCount ?? DEFAULT_BLAME_PAGE_LINES),
  );

  const result = await runGitCommand(
    [
      "blame",
      "--porcelain",
      `-L${startLine},+${lineCount}`,
      ...(input.sha ? [input.sha] : []),
      "--",
      input.path,
    ],
    {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      timeout: BLAME_TIMEOUT_MS,
      // `-L` past the end of the file is a normal outcome when paging, not an
      // error: git exits 128 with "has only N lines" and we report an empty page.
      acceptExitCodes: [0, 128],
    },
  );

  if (result.exitCode !== 0) {
    if (/has only \d+ lines?/i.test(result.stderr)) {
      return {
        lines: [],
        commits: [],
        startLine,
        endLine: startLine - 1,
        reachedEndOfFile: true,
      };
    }
    throw new Error(result.stderr.trim() || "git blame failed");
  }

  const { commits, lines } = parseBlamePorcelain(result.stdout);
  const endLine = lines.length > 0 ? Math.max(...lines.map((entry) => entry.line)) : startLine - 1;
  return {
    lines,
    commits: Array.from(commits.values()),
    startLine,
    endLine,
    reachedEndOfFile: lines.length < lineCount,
  };
}

const ORIGIN_FORMAT = HISTORY_FORMAT;

/**
 * The commit that first added the file — "who originally wrote this". Uses
 * `--follow` so a file that was renamed reports its true origin rather than the
 * rename commit.
 */
export async function getFileOriginCommit(
  cwd: string,
  input: { path: string },
): Promise<GitFileHistoryEntry | null> {
  assertRepoRelativeFilePath(input.path);

  const runLog = async (extraArgs: string[]): Promise<GitFileHistoryEntry | null> => {
    const { stdout } = await runGitCommand(
      [
        "log",
        "--follow",
        "-M",
        `--format=${ORIGIN_FORMAT}`,
        "--name-status",
        ...extraArgs,
        "--",
        input.path,
      ],
      { cwd, envOverlay: READ_ONLY_GIT_ENV, timeout: HISTORY_TIMEOUT_MS },
    );
    const records = parseHistoryRecords(stdout, input.path);
    // `--reverse` is applied after `-n`, so it cannot be used to ask git for the
    // oldest commit directly; walk to the last record instead.
    const oldest = records.at(-1);
    if (!oldest) return null;
    if (oldest.nameStatus) {
      applyNameStatus(oldest.entry, oldest.nameStatus);
    }
    return oldest.entry;
  };

  // The add commit is the honest answer and is usually a one-record walk.
  const added = await runLog(["--diff-filter=A"]);
  if (added) return added;
  // No add commit in range (shallow clone, or the file arrived via a merge):
  // fall back to the oldest commit that touched it.
  return runLog([]);
}
