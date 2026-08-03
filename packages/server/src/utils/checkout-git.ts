import { resolve, dirname, basename } from "path";
import { existsSync, realpathSync } from "fs";
import { open as openFile, readFile, stat as statFile } from "fs/promises";
import { TTLCache } from "@isaacs/ttlcache";
import type { Logger } from "pino";
import type { CheckoutCommit, CheckoutCommitFile } from "@otto-code/protocol/messages";
import type { ParsedDiffFile } from "../server/utils/diff-highlighter.js";
import { parseAndHighlightDiff } from "../server/utils/diff-highlighter.js";
import { parseGitHubRepoFromRemote } from "../server/workspace-git-metadata.js";
import {
  GitHubAuthenticationError,
  GitHubCliMissingError,
  GitHubCommandError,
  createGitHubService,
  type CurrentPullRequestStatus,
  type ForgeAuthState,
  type GitHubPullRequestStatusFacts,
  type ForgeService,
  type PullRequestMergeable,
} from "../services/github-service.js";
import { isGitHostingFeatureDisabledError } from "../services/git-hosting/types.js";
import { parseGitRevParsePath, resolveGitRevParsePath } from "./git-rev-parse-path.js";
import { runGitCommand, type GitCommandResult } from "./run-git-command.js";
import { isOttoOwnedWorktreeCwd, resolveOttoWorktreesBaseRoot } from "./worktree.js";
import {
  normalizeAndValidateBaseRefName,
  readOttoWorktreeMetadata,
  setOttoWorktreeBaseRefName,
  validateBaseRefNameAllowingRemote,
} from "./worktree-metadata.js";
import {
  clearStoredDiffBaseForBranch,
  readStoredDiffBaseForBranch,
  writeStoredDiffBaseForBranch,
  type DiffBaseSource,
} from "./checkout-diff-base-store.js";
import { inferParentBranchRef } from "./checkout-git-parent-branch.js";
const READ_ONLY_GIT_ENV = {
  GIT_OPTIONAL_LOCKS: "0",
} as const;

/**
 * Why a git mutation is forcing a workspace snapshot refresh. Shared between the
 * Session shell (which owns the refresh primitive) and the checkout subsystem
 * (which triggers most of these reasons after a write).
 */
export type GitMutationRefreshReason =
  | "commit-changes"
  | "rollback-changes"
  | "pull"
  | "push"
  | "merge-to-base"
  | "merge-from-base"
  | "merge-pr"
  | "enable-pr-auto-merge"
  | "disable-pr-auto-merge"
  | "create-pr"
  | "switch-branch"
  | "rename-branch"
  | "create-branch"
  | "stash-push"
  | "stash-pop"
  | "create-worktree";

const DEFAULT_PULL_REQUEST_STATUS_CACHE_TTL_MS = 30_000;
const PULL_REQUEST_STATUS_CACHE_MAX = 1_000;
const DEFAULT_SHORTSTAT_CACHE_TTL_MS = 15_000;
const SHORTSTAT_CACHE_MAX = 1_000;

let pullRequestStatusCacheTtlMs = DEFAULT_PULL_REQUEST_STATUS_CACHE_TTL_MS;
let pullRequestStatusCache = createPullRequestStatusCache(pullRequestStatusCacheTtlMs);
const pullRequestStatusInFlight = new Map<string, Promise<PullRequestStatusResult>>();
const lastSuccessfulPullRequestStatus = new Map<string, PullRequestStatusResult>();
let shortstatCacheTtlMs = DEFAULT_SHORTSTAT_CACHE_TTL_MS;
let shortstatCache = createShortstatCache(shortstatCacheTtlMs);
const shortstatInFlight = new Map<string, Promise<CheckoutShortstat | null>>();

interface CheckoutReadCacheOptions {
  force?: boolean;
  reason?: string;
}

interface PullRequestStatusLookupTarget {
  headRef: string;
  headRepositoryOwner?: string;
}

interface PullRequestLookupTargetBranchConfig {
  currentBranch: string;
  branchRemoteName: string | null;
  branchMergeRef: string | null;
  branchRemoteUrl: string | null;
  originRemoteUrl: string | null;
  resolvedBaseRef: string | null;
}

interface PullRequestLookupTargetPushConfig {
  currentBranch: string;
  pushRemoteName: string | null;
  pushRefspec: string | null;
  pushRemoteUrl: string | null;
  originRemoteUrl: string | null;
  resolvedBaseRef: string | null;
}

function getErrorStderr(error: Error): string {
  return "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
}

function getErrorStdout(error: Error): string {
  return "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
}

function throwBranchNotFound(branch: string | undefined): never {
  throw new Error(`Branch not found: ${branch ?? "unknown"}`);
}

function createPullRequestStatusCache(ttlMs: number) {
  return new TTLCache<string, PullRequestStatusResult>({
    ttl: ttlMs,
    max: PULL_REQUEST_STATUS_CACHE_MAX,
    checkAgeOnGet: true,
  });
}

function createShortstatCache(ttlMs: number) {
  return new TTLCache<string, CheckoutShortstat | null>({
    ttl: ttlMs,
    max: SHORTSTAT_CACHE_MAX,
    checkAgeOnGet: true,
  });
}

function getPullRequestStatusCacheKey(cwd: string): string {
  return resolve(cwd);
}

function rememberPullRequestStatus(cacheKey: string, status: PullRequestStatusResult): void {
  lastSuccessfulPullRequestStatus.set(cacheKey, status);
  if (lastSuccessfulPullRequestStatus.size <= PULL_REQUEST_STATUS_CACHE_MAX) {
    return;
  }
  const oldest = lastSuccessfulPullRequestStatus.keys().next();
  if (!oldest.done) {
    lastSuccessfulPullRequestStatus.delete(oldest.value);
  }
}

function getShortstatCacheKey(cwd: string): string {
  return resolve(cwd);
}

export function __resetPullRequestStatusCacheForTests(): void {
  pullRequestStatusCache.clear();
  pullRequestStatusCache.cancelTimer();
  pullRequestStatusCacheTtlMs = DEFAULT_PULL_REQUEST_STATUS_CACHE_TTL_MS;
  pullRequestStatusCache = createPullRequestStatusCache(pullRequestStatusCacheTtlMs);
  pullRequestStatusInFlight.clear();
  lastSuccessfulPullRequestStatus.clear();
}

export function __setPullRequestStatusCacheTtlForTests(ttlMs: number): void {
  pullRequestStatusCache.clear();
  pullRequestStatusCache.cancelTimer();
  pullRequestStatusCacheTtlMs = ttlMs;
  pullRequestStatusCache = createPullRequestStatusCache(ttlMs);
  pullRequestStatusInFlight.clear();
  lastSuccessfulPullRequestStatus.clear();
}

export function __resetCheckoutShortstatCacheForTests(): void {
  shortstatCache.clear();
  shortstatCache.cancelTimer();
  shortstatCacheTtlMs = DEFAULT_SHORTSTAT_CACHE_TTL_MS;
  shortstatCache = createShortstatCache(shortstatCacheTtlMs);
  shortstatInFlight.clear();
}

export function __setCheckoutShortstatCacheTtlForTests(ttlMs: number): void {
  shortstatCache.clear();
  shortstatCache.cancelTimer();
  shortstatCacheTtlMs = ttlMs;
  shortstatCache = createShortstatCache(ttlMs);
  shortstatInFlight.clear();
}

interface CheckoutFileChange {
  path: string;
  oldPath?: string;
  status: string;
  isNew: boolean;
  isDeleted: boolean;
  isUntracked?: boolean;
}

interface CheckoutDiffRefs {
  baseRef: string;
  targetRef?: string;
  includeUntracked: boolean;
}

function getCheckoutDiffRefArgs(refs: CheckoutDiffRefs): string[] {
  return [refs.baseRef, ...(refs.targetRef ? [refs.targetRef] : [])];
}

function normalizeBranchSuggestionName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  let normalized = trimmed;
  if (normalized.startsWith("refs/heads/")) {
    normalized = normalized.slice("refs/heads/".length);
  } else if (normalized.startsWith("refs/remotes/")) {
    normalized = normalized.slice("refs/remotes/".length);
  }

  if (normalized.startsWith("origin/")) {
    normalized = normalized.slice("origin/".length);
  }

  if (!normalized || normalized === "HEAD" || normalized === "origin") {
    return null;
  }

  return normalized;
}

interface GitRef {
  name: string;
  committerDate: number;
}

export interface BranchSuggestion {
  name: string;
  committerDate: number;
  hasLocal: boolean;
  hasRemote: boolean;
  /**
   * True when the branch is checked out in a worktree other than the one
   * containing the requesting cwd. Git refuses `git checkout` of such a
   * branch, so pickers can disable it up front instead of erroring after.
   * Optional to match the wire schema; absent means "unknown", which clients
   * treat as not disabled.
   */
  checkedOutElsewhere?: boolean;
}

/**
 * Branch names checked out in worktrees other than the one containing `cwd`.
 * Git allows a branch in at most one worktree, so "checked out somewhere and
 * not the current branch of cwd" is exactly "checked out elsewhere".
 * Best-effort: failures degrade to "nothing disabled", never a thrown error.
 */
async function listBranchesCheckedOutElsewhere(cwd: string): Promise<Set<string>> {
  try {
    const [worktreeResult, currentBranchResult] = await Promise.all([
      runGitCommand(["worktree", "list", "--porcelain"], { cwd, envOverlay: READ_ONLY_GIT_ENV }),
      runGitCommand(["branch", "--show-current"], { cwd, envOverlay: READ_ONLY_GIT_ENV }),
    ]);
    const currentBranch = currentBranchResult.stdout.trim();
    const names = new Set<string>();
    for (const line of worktreeResult.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("branch ")) continue;
      const ref = trimmed.slice("branch ".length).trim();
      const name = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
      if (!name || name === currentBranch) continue;
      names.add(name);
    }
    return names;
  } catch {
    return new Set();
  }
}

async function listGitRefs(cwd: string, refPrefix: string): Promise<GitRef[]> {
  const { stdout } = await runGitCommand(
    [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname)%09%(committerdate:unix)",
      refPrefix,
    ],
    { cwd, envOverlay: READ_ONLY_GIT_ENV },
  );
  return stdout
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const [name, dateStr] = trimmed.split("\t");
      if (!name) return null;
      return { name, committerDate: Number(dateStr) || 0 };
    })
    .filter((ref): ref is GitRef => ref !== null);
}

interface BranchSuggestionMeta {
  committerDate: number;
  hasLocal: boolean;
  hasRemote: boolean;
}

function sortBranchSuggestions(
  branchNames: string[],
  branchMeta: Map<string, BranchSuggestionMeta>,
  query: string,
): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  const hasQuery = normalizedQuery.length > 0;
  return branchNames.sort((a, b) => {
    if (hasQuery) {
      const aPrefix = a.toLowerCase().startsWith(normalizedQuery);
      const bPrefix = b.toLowerCase().startsWith(normalizedQuery);
      if (aPrefix !== bPrefix) {
        return aPrefix ? -1 : 1;
      }
    }

    const aMeta = branchMeta.get(a);
    const bMeta = branchMeta.get(b);
    const aDate = aMeta?.committerDate ?? 0;
    const bDate = bMeta?.committerDate ?? 0;
    if (aDate !== bDate) {
      return bDate - aDate;
    }

    return a.localeCompare(b);
  });
}

export async function listBranchSuggestions(
  cwd: string,
  options?: { query?: string; limit?: number },
): Promise<BranchSuggestion[]> {
  await requireGitRepo(cwd);

  const requestedLimit = options?.limit ?? 50;
  const limit = Math.max(1, Math.min(200, requestedLimit));
  const query = options?.query?.trim().toLowerCase() ?? "";

  const [localRefs, remoteRefs, checkedOutElsewhereNames] = await Promise.all([
    listGitRefs(cwd, "refs/heads"),
    listGitRefs(cwd, "refs/remotes/origin"),
    listBranchesCheckedOutElsewhere(cwd),
  ]);

  const branchMeta = new Map<string, BranchSuggestionMeta>();

  for (const ref of localRefs) {
    const normalized = normalizeBranchSuggestionName(ref.name);
    if (!normalized) continue;
    const existing = branchMeta.get(normalized);
    branchMeta.set(normalized, {
      hasLocal: true,
      hasRemote: existing?.hasRemote ?? false,
      committerDate: Math.max(ref.committerDate, existing?.committerDate ?? 0),
    });
  }

  for (const ref of remoteRefs) {
    const normalized = normalizeBranchSuggestionName(ref.name);
    if (!normalized) continue;
    const existing = branchMeta.get(normalized);
    if (!existing) {
      branchMeta.set(normalized, {
        hasLocal: false,
        hasRemote: true,
        committerDate: ref.committerDate,
      });
    } else {
      branchMeta.set(normalized, {
        ...existing,
        hasRemote: true,
        committerDate: Math.max(ref.committerDate, existing.committerDate),
      });
    }
  }

  const filteredNames = Array.from(branchMeta.keys()).filter((name) =>
    query ? name.toLowerCase().includes(query) : true,
  );
  if (filteredNames.length === 0) {
    return [];
  }

  const ordered = sortBranchSuggestions(filteredNames, branchMeta, query);
  return ordered.slice(0, limit).map((name) => {
    const meta = branchMeta.get(name);
    return {
      name,
      committerDate: meta?.committerDate ?? 0,
      hasLocal: meta?.hasLocal ?? false,
      hasRemote: meta?.hasRemote ?? false,
      checkedOutElsewhere: checkedOutElsewhereNames.has(name),
    };
  });
}

export interface LocalBranchCheckoutResolution {
  kind: "local";
  name: string;
}

export interface RemoteOnlyBranchCheckoutResolution {
  kind: "remote-only";
  name: string;
  remoteRef: string;
}

export interface NotFoundBranchCheckoutResolution {
  kind: "not-found";
}

export type BranchCheckoutResolution =
  | LocalBranchCheckoutResolution
  | RemoteOnlyBranchCheckoutResolution
  | NotFoundBranchCheckoutResolution;

export async function resolveBranchCheckout(
  cwd: string,
  name: string,
): Promise<BranchCheckoutResolution> {
  await requireGitRepo(cwd);

  const normalized = normalizeBranchSuggestionName(name);
  if (!normalized) {
    return { kind: "not-found" };
  }

  const localRef = `refs/heads/${normalized}`;
  const localResult = await runGitCommand(["rev-parse", "--verify", "--quiet", localRef], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 1],
  });
  const hasLocal = localResult.exitCode === 0;
  if (hasLocal) {
    return { kind: "local", name: normalized };
  }

  const remoteRef = `origin/${normalized}`;
  const remoteRefPath = `refs/remotes/${remoteRef}`;
  const remoteResult = await runGitCommand(["rev-parse", "--verify", "--quiet", remoteRefPath], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 1],
  });
  const hasRemote = remoteResult.exitCode === 0;
  if (hasRemote) {
    return { kind: "remote-only", name: normalized, remoteRef };
  }

  return { kind: "not-found" };
}

export type BranchCheckoutSource = "local" | "remote";

export interface CheckoutExistingBranchResult {
  source: BranchCheckoutSource;
}

export interface CheckoutResolvedBranchInput {
  cwd: string;
  resolution: BranchCheckoutResolution;
  requestedBranch?: string;
}

export async function checkoutResolvedBranch(
  input: CheckoutResolvedBranchInput,
): Promise<CheckoutExistingBranchResult> {
  const { cwd, resolution } = input;

  switch (resolution.kind) {
    case "local": {
      const { stdout } = await runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
      const current = stdout.trim();
      if (current === resolution.name) {
        return { source: "local" };
      }

      await runGitCommand(["checkout", resolution.name], { cwd });
      return { source: "local" };
    }
    case "remote-only":
      await runGitCommand(["checkout", "-b", resolution.name, "--track", resolution.remoteRef], {
        cwd,
      });
      return { source: "remote" };
    default:
      return throwBranchNotFound(input.requestedBranch);
  }
}

async function listCheckoutFileChanges(
  cwd: string,
  refs: CheckoutDiffRefs,
  ignoreWhitespace = false,
): Promise<CheckoutFileChange[]> {
  const changes: CheckoutFileChange[] = [];

  const { stdout: nameStatusOut } = await runGitCommand(
    buildGitDiffArgs({
      ignoreWhitespace,
      extra: ["--name-status", ...getCheckoutDiffRefArgs(refs)],
    }),
    { cwd, envOverlay: READ_ONLY_GIT_ENV },
  );
  for (const line of nameStatusOut
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    // `--name-status` uses TAB separators, which preserves filenames with spaces.
    const tabParts = line.split("\t");
    const rawStatus = (tabParts[0] ?? "").trim();
    if (!rawStatus) continue;

    if (rawStatus.startsWith("R") || rawStatus.startsWith("C")) {
      const oldPath = tabParts[1];
      const newPath = tabParts[2];
      if (newPath) {
        changes.push({
          path: newPath,
          ...(oldPath ? { oldPath } : {}),
          status: rawStatus,
          isNew: false,
          isDeleted: false,
        });
      }
      continue;
    }

    const path = tabParts[1];
    if (!path) continue;
    const code = rawStatus[0];
    changes.push({
      path,
      status: rawStatus,
      isNew: code === "A",
      isDeleted: code === "D",
    });
  }

  if (refs.includeUntracked) {
    const { stdout: untrackedOut } = await runGitCommand(
      ["ls-files", "--others", "--exclude-standard"],
      {
        cwd,
        envOverlay: READ_ONLY_GIT_ENV,
      },
    );
    for (const file of untrackedOut
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)) {
      changes.push({
        path: file,
        status: "U",
        isNew: true,
        isDeleted: false,
        isUntracked: true,
      });
    }
  }

  // Deduplicate by path (prefer tracked status over untracked marker if both appear).
  const byPath = new Map<string, CheckoutFileChange>();
  for (const change of changes) {
    const existing = byPath.get(change.path);
    if (!existing) {
      byPath.set(change.path, change);
      continue;
    }
    if (existing.isUntracked && !change.isUntracked) {
      byPath.set(change.path, change);
    }
  }
  return Array.from(byPath.values());
}

async function readGitFileContentAtRef(
  cwd: string,
  ref: string,
  path: string,
): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["show", `${ref}:${path}`], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function tryResolveMergeBase(cwd: string, baseRef: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["merge-base", baseRef, "HEAD"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const sha = stdout.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

type FileStat = { additions: number; deletions: number; isBinary: boolean } | null;

function normalizeNumstatPath(pathField: string): string {
  const braceRenameMatch = pathField.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceRenameMatch) {
    const [, prefix, , renamed, suffix] = braceRenameMatch;
    return `${prefix}${renamed}${suffix}`;
  }

  const inlineRenameMatch = pathField.match(/^(.*) => (.*)$/);
  if (inlineRenameMatch) {
    return inlineRenameMatch[2] ?? pathField;
  }

  return pathField;
}

function buildGitDiffArgs(args: { ignoreWhitespace?: boolean; extra: string[] }): string[] {
  return ["diff", ...(args.ignoreWhitespace ? ["-w"] : []), ...args.extra];
}

const TRACKED_DIFF_NUMSTAT_MAX_BYTES = 2 * 1024 * 1024; // 2MB
const EMPTY_TREE_OBJECT_ID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function isUnbornHeadDiffError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("--name-status HEAD") &&
    error.message.includes("ambiguous argument 'HEAD'")
  );
}

async function getTrackedNumstatByPath(
  cwd: string,
  refs: CheckoutDiffRefs,
  ignoreWhitespace = false,
): Promise<Map<string, FileStat>> {
  const result = await runGitCommand(
    buildGitDiffArgs({
      ignoreWhitespace,
      extra: ["--numstat", ...getCheckoutDiffRefArgs(refs)],
    }),
    {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      maxOutputBytes: TRACKED_DIFF_NUMSTAT_MAX_BYTES,
      acceptExitCodes: [0],
    },
  );

  const stats = new Map<string, FileStat>();
  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }

    const additionsField = parts[0] ?? "";
    const deletionsField = parts[1] ?? "";
    const rawPath = parts.slice(2).join("\t");
    const path = normalizeNumstatPath(rawPath);

    if (!path) {
      continue;
    }

    if (additionsField === "-" || deletionsField === "-") {
      stats.set(path, { additions: 0, deletions: 0, isBinary: true });
      continue;
    }

    const additions = Number.parseInt(additionsField, 10);
    const deletions = Number.parseInt(deletionsField, 10);
    if (Number.isNaN(additions) || Number.isNaN(deletions)) {
      stats.set(path, null);
      continue;
    }

    stats.set(path, { additions, deletions, isBinary: false });
  }

  return stats;
}

async function getTrackedDiffTextForPath(input: {
  cwd: string;
  refsForDiff: CheckoutDiffRefs;
  path: string;
  ignoreWhitespace: boolean;
}): Promise<{ path: string; text: string; truncated: boolean }> {
  const result = await runGitCommand(
    buildGitDiffArgs({
      ignoreWhitespace: input.ignoreWhitespace,
      extra: [...getCheckoutDiffRefArgs(input.refsForDiff), "--", input.path],
    }),
    {
      cwd: input.cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      maxOutputBytes: PER_FILE_DIFF_MAX_BYTES,
    },
  );

  return {
    path: input.path,
    text: result.stdout,
    truncated: result.truncated,
  };
}

export class NotGitRepoError extends Error {
  readonly cwd: string;
  readonly code = "NOT_GIT_REPO";

  constructor(cwd: string) {
    super(`Not a git repository: ${cwd}`);
    this.name = "NotGitRepoError";
    this.cwd = cwd;
  }
}

export class MergeConflictError extends Error {
  readonly baseRef: string;
  readonly currentBranch: string;
  readonly conflictFiles: string[];

  constructor(options: { baseRef: string; currentBranch: string; conflictFiles: string[] }) {
    super(`Merge conflict while merging ${options.currentBranch} into ${options.baseRef}`);
    this.name = "MergeConflictError";
    this.baseRef = options.baseRef;
    this.currentBranch = options.currentBranch;
    this.conflictFiles = options.conflictFiles;
  }
}

export class MergeFromBaseConflictError extends Error {
  readonly baseRef: string;
  readonly currentBranch: string;
  readonly conflictFiles: string[];

  constructor(options: { baseRef: string; currentBranch: string; conflictFiles: string[] }) {
    super(
      `Merge conflict while merging ${options.baseRef} into ${options.currentBranch}. Please merge manually.`,
    );
    this.name = "MergeFromBaseConflictError";
    this.baseRef = options.baseRef;
    this.currentBranch = options.currentBranch;
    this.conflictFiles = options.conflictFiles;
  }
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

export interface CheckoutStatus {
  isGit: false;
}

export interface CheckoutStatusGitNonOtto {
  isGit: true;
  repoRoot: string;
  mainRepoRoot: string | null;
  currentBranch: string | null;
  isDirty: boolean;
  baseRef: string | null;
  // Optional so the many test stubs that build a status by hand stay valid; the real
  // implementation always sets it.
  baseSource?: CheckoutBaseSource | null;
  aheadBehind: AheadBehind | null;
  aheadOfOrigin: number | null;
  behindOfOrigin: number | null;
  hasRemote: boolean;
  remoteUrl: string | null;
  isOttoOwnedWorktree: false;
}

export interface CheckoutStatusGitOtto {
  isGit: true;
  repoRoot: string;
  mainRepoRoot: string;
  currentBranch: string | null;
  isDirty: boolean;
  baseRef: string;
  // Optional so the many test stubs that build a status by hand stay valid; the real
  // implementation always sets it.
  baseSource?: CheckoutBaseSource | null;
  aheadBehind: AheadBehind | null;
  aheadOfOrigin: number | null;
  behindOfOrigin: number | null;
  hasRemote: boolean;
  remoteUrl: string | null;
  isOttoOwnedWorktree: true;
}

export type CheckoutStatusGit = CheckoutStatusGitNonOtto | CheckoutStatusGitOtto;

export type CheckoutStatusResult = CheckoutStatus | CheckoutStatusGit;

export type CheckoutDiffResult =
  | { diff: string; structured?: ParsedDiffFile[]; diffTooLarge?: false }
  | { diff: ""; structured: []; diffTooLarge: true };

export interface CheckoutDiffCompare {
  mode: "uncommitted" | "base";
  baseRef?: string;
  ignoreWhitespace?: boolean;
  includeStructured?: boolean;
}

export interface MergeToBaseOptions {
  baseRef?: string;
  mode?: "merge" | "squash";
  commitMessage?: string;
}

export interface MergeFromBaseOptions {
  baseRef?: string;
  requireCleanTarget?: boolean;
}

export interface CheckoutContext {
  ottoHome?: string;
  worktreesRoot?: string;
  logger?: Pick<Logger, "trace">;
  facts?: CheckoutSnapshotFacts | null;
}

export type CheckoutSnapshotFacts =
  | {
      isGit: false;
    }
  | {
      isGit: true;
      worktreeRoot: string;
      currentBranch: string | null;
      remoteUrl: string | null;
      absoluteGitDir: string | null;
      gitCommonDir: string | null;
      ottoWorktree: OttoWorktreeForCwd;
      storedBaseRef: string | null;
      resolvedBaseRef: string | null;
      baseSource: CheckoutBaseSource | null;
      mainRepoRoot: string | null;
      comparisonBaseRef: string | null;
      branchRemoteName: string | null;
      branchMergeRef: string | null;
      pullRequestLookupTarget: PullRequestStatusLookupTarget | null;
    };

function isGitError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /not a git repository/i.test(error.message) || /git repository/i.test(error.message);
}

async function requireGitRepo(cwd: string): Promise<void> {
  try {
    await runGitCommand(["rev-parse", "--git-dir"], { cwd, envOverlay: READ_ONLY_GIT_ENV });
  } catch {
    throw new NotGitRepoError(cwd);
  }
}

export async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const branch = stdout.trim();
    if (branch === "HEAD") {
      return await getRebaseHeadBranch(cwd);
    }
    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

async function getRebaseHeadBranch(cwd: string): Promise<string | null> {
  const paths = ["rebase-merge/head-name", "rebase-apply/head-name"];
  const results = await Promise.all(
    paths.map(async (path): Promise<string | null> => {
      try {
        const { stdout } = await runGitCommand(["rev-parse", "--git-path", path], {
          cwd,
          envOverlay: READ_ONLY_GIT_ENV,
        });
        const headName = (await readFile(resolve(cwd, stdout.trim()), "utf8")).trim();
        if (headName.startsWith("refs/heads/")) {
          return headName.slice("refs/heads/".length) || null;
        }
        return headName || null;
      } catch {
        return null;
      }
    }),
  );
  return results.find((result): result is string => result !== null) ?? null;
}

async function getWorktreeRoot(cwd: string, context?: CheckoutContext): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["rev-parse", "--show-toplevel"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      logger: context?.logger,
    });
    return parseGitRevParsePath(stdout);
  } catch {
    return null;
  }
}

export async function getMainRepoRoot(cwd: string): Promise<string> {
  const { stdout: commonDirOut } = await runGitCommand(["rev-parse", "--git-common-dir"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  return getMainRepoRootFromCommonDir(cwd, resolveGitRevParsePath(cwd, commonDirOut));
}

async function getMainRepoRootFromCommonDir(
  cwd: string,
  commonDir: string | null,
  context?: CheckoutContext,
): Promise<string> {
  if (!commonDir) {
    throw new Error("Not in a git repository");
  }
  const normalized = realpathSync(commonDir);

  if (basename(normalized) === ".git") {
    return dirname(normalized);
  }

  const { stdout: worktreeOut } = await runGitCommand(["worktree", "list", "--porcelain"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  const worktrees = parseWorktreeList(worktreeOut);
  const nonBareNonOtto = worktrees.filter(
    (wt) =>
      !wt.isBare &&
      !isOttoWorktreePath(wt.path, {
        ottoHome: context?.ottoHome,
        worktreesRoot: context?.worktreesRoot,
      }),
  );
  const childrenOfBareRepo = nonBareNonOtto.filter((wt) => isDescendantPath(wt.path, normalized));
  const mainChild = childrenOfBareRepo.find((wt) => basename(wt.path) === "main");
  return mainChild?.path ?? childrenOfBareRepo[0]?.path ?? nonBareNonOtto[0]?.path ?? normalized;
}

export interface GitWorktreeEntry {
  path: string;
  branchRef?: string;
  isBare?: boolean;
}

/** Check whether a path is under Otto's worktree root. */
export function isOttoWorktreePath(
  p: string,
  options?: { ottoHome?: string; worktreesRoot?: string },
): boolean {
  if (options?.worktreesRoot || options?.ottoHome) {
    return isDescendantPath(p, resolveOttoWorktreesBaseRoot(options));
  }
  return /[/\\]\.otto[/\\]worktrees[/\\]/.test(p);
}

/** True when `child` is strictly inside `parent` (handles both `/` and `\`). */
export function isDescendantPath(child: string, parent: string): boolean {
  let c = child.replace(/\\/g, "/").replace(/\/+$/, "");
  let p = parent.replace(/\\/g, "/").replace(/\/+$/, "");
  // Case-insensitive on Windows (drive letter like C: or D:)
  if (/^[A-Za-z]:/.test(c) || /^[A-Za-z]:/.test(p)) {
    c = c.toLowerCase();
    p = p.toLowerCase();
  }
  if (!c.startsWith(p)) return false;
  if (c.length === p.length) return false;
  return c[p.length] === "/";
}

export function parseWorktreeList(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | null = null;
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("worktree ")) {
      if (current) {
        entries.push(current);
      }
      current = { path: trimmed.slice("worktree ".length).trim() };
      continue;
    }
    if (current && trimmed.startsWith("branch ")) {
      current.branchRef = trimmed.slice("branch ".length).trim();
    }
    if (current && trimmed === "bare") {
      current.isBare = true;
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

async function getWorktreePathForBranch(cwd: string, branchName: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["worktree", "list", "--porcelain"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const entries = parseWorktreeList(stdout);
    const ref = branchName.startsWith("refs/heads/") ? branchName : `refs/heads/${branchName}`;
    return entries.find((entry) => entry.branchRef === ref)?.path ?? null;
  } catch {
    return null;
  }
}

export async function localBranchExists(cwd: string, branchName: string): Promise<boolean> {
  return doesGitRefExist(cwd, `refs/heads/${branchName}`);
}

export async function renameCurrentBranch(
  cwd: string,
  newName: string,
): Promise<{ previousBranch: string | null; currentBranch: string | null }> {
  await requireGitRepo(cwd);

  const previousBranch = await getCurrentBranch(cwd);
  if (!previousBranch || previousBranch === "HEAD") {
    throw new Error("Cannot rename branch in detached HEAD state");
  }

  await runGitCommand(["branch", "-m", newName], {
    cwd,
    timeout: 120_000,
  });

  const currentBranch = await getCurrentBranch(cwd);
  return { previousBranch, currentBranch };
}

type OttoWorktreeForCwd =
  | { isOttoOwnedWorktree: false }
  | { isOttoOwnedWorktree: true; worktreeRoot: string };

async function getOttoWorktreeForCwd(
  cwd: string,
  context?: CheckoutContext,
  knownWorktreeRoot?: string | null,
): Promise<OttoWorktreeForCwd> {
  // Fast-path reject: non-worktree paths do not need expensive ownership checks.
  if (!/[\\/]worktrees[\\/]/.test(cwd)) {
    return { isOttoOwnedWorktree: false };
  }

  const ownership = await isOttoOwnedWorktreeCwd(cwd, {
    ottoHome: context?.ottoHome,
    worktreesRoot: context?.worktreesRoot,
  });
  if (!ownership.allowed) {
    return { isOttoOwnedWorktree: false };
  }

  return {
    isOttoOwnedWorktree: true,
    worktreeRoot: knownWorktreeRoot ?? (await getWorktreeRoot(cwd)) ?? cwd,
  };
}

function readOttoWorktreeBaseRef(worktreeRoot: string): string | null {
  return readOttoWorktreeMetadata(worktreeRoot)?.baseRefName ?? null;
}

async function getResolvedBaseRefForCwd(
  cwd: string,
  context?: CheckoutContext,
): Promise<string | null> {
  if (context?.facts?.isGit) {
    return context.facts.resolvedBaseRef;
  }
  const { resolvedBaseRef } = await resolveBaseRefForCwd(cwd, context);
  return resolvedBaseRef;
}

interface BaseRefResolution {
  storedBaseRef: string | null;
  resolvedBaseRef: string | null;
  baseSource: CheckoutBaseSource | null;
}

async function resolveBaseRefForCwd(
  cwd: string,
  context?: CheckoutContext,
): Promise<BaseRefResolution> {
  if (context?.facts?.isGit) {
    return {
      storedBaseRef: context.facts.storedBaseRef,
      resolvedBaseRef: context.facts.resolvedBaseRef,
      baseSource: context.facts.baseSource,
    };
  }
  const [worktreeRoot, currentBranch, ottoWorktree] = await Promise.all([
    getWorktreeRoot(cwd),
    getCurrentBranch(cwd),
    getOttoWorktreeForCwd(cwd, context),
  ]);
  return resolveBaseRefLadder(cwd, {
    worktreeRoot: worktreeRoot ?? cwd,
    currentBranch,
    ottoWorktree,
    context,
  });
}

/**
 * Where the Changes view's base branch comes from. Surfaced to the client so the chip can say
 * *why* it is comparing against this branch — an inferred parent is a heuristic and has to look
 * like one, or a wrong guess reads as a bug in the diff.
 */
export type CheckoutBaseSource = "user" | "inferred" | "worktree" | "default";

interface BaseRefLadderInput {
  worktreeRoot: string;
  currentBranch: string | null;
  ottoWorktree: OttoWorktreeForCwd;
  context?: CheckoutContext;
}

/**
 * The single answer to "what is this diffed against?".
 *
 * Every consumer — the diff, ahead/behind, the shortstat badge, merge-into-base and PR creation —
 * funnels through here. Keep it that way: the previous shape computed the base in two places and
 * the doc already warns that copies of this logic mean different answers to the same question.
 *
 * The ladder, in order:
 *
 * 1. **The branch's remembered base.** A user pick, or a parent detected earlier. Sticky by
 *    design — a heuristic that silently re-decides itself every read is worse than no heuristic.
 * 2. **An Otto worktree's creation-time base**, which already records the branch it was cut from.
 * 3. **The inferred parent branch**, then remembered so step 1 answers from here on.
 * 4. **The repository default branch**, when nothing forks.
 * 5. If that lands on the branch you are standing on, **`origin/<branch>`** — on the default
 *    branch `merge-base(main, HEAD)` is HEAD, so "vs main" would always be empty. Comparing
 *    against the remote-tracking ref shows unpushed local commits, which is the useful answer.
 */
async function resolveBaseRefLadder(
  cwd: string,
  input: BaseRefLadderInput,
): Promise<BaseRefResolution> {
  const { worktreeRoot, currentBranch, ottoWorktree, context } = input;

  if (currentBranch) {
    const remembered = readStoredDiffBaseForBranch(worktreeRoot, currentBranch);
    if (remembered) {
      const healed = await healRememberedBaseRef(cwd, {
        worktreeRoot,
        currentBranch,
        remembered,
        context,
      });
      if (healed) {
        return {
          storedBaseRef: healed.ref,
          resolvedBaseRef: healed.ref,
          baseSource: healed.source,
        };
      }
    }
  }

  const worktreeBaseRef = ottoWorktree.isOttoOwnedWorktree
    ? readOttoWorktreeBaseRef(ottoWorktree.worktreeRoot)
    : null;
  if (worktreeBaseRef) {
    return {
      storedBaseRef: worktreeBaseRef,
      resolvedBaseRef: worktreeBaseRef,
      baseSource: "worktree",
    };
  }

  const defaultBranch = await resolveBaseRef(cwd).catch(() => null);
  const detected = await detectBaseRefForBranch(cwd, {
    currentBranch,
    defaultBranch,
    context,
  });
  if (!detected) {
    return { storedBaseRef: null, resolvedBaseRef: defaultBranch, baseSource: "default" };
  }

  // Remembered even when it came from the fallback rather than the graph. Without this the
  // candidate scan would re-run on every snapshot refresh for every branch that has no
  // detectable parent — the default branch, most notably, which is where most sessions sit.
  if (currentBranch) {
    persistDetectedBaseRef(worktreeRoot, currentBranch, detected.ref, context);
  }
  return {
    storedBaseRef: detected.ref,
    resolvedBaseRef: detected.ref,
    baseSource: detected.source,
  };
}

interface DetectedBaseRef {
  ref: string;
  source: CheckoutBaseSource;
}

async function detectBaseRefForBranch(
  cwd: string,
  input: {
    currentBranch: string | null;
    defaultBranch: string | null;
    context?: CheckoutContext;
  },
): Promise<DetectedBaseRef | null> {
  const { currentBranch, defaultBranch, context } = input;
  if (!currentBranch || currentBranch === "HEAD") {
    return defaultBranch ? { ref: defaultBranch, source: "default" } : null;
  }

  const inferred = await inferParentBranchRef(cwd, {
    currentBranch,
    defaultBranch,
    ...(context?.logger ? { logger: context.logger as Logger } : {}),
  }).catch(() => null);
  if (inferred) {
    return { ref: inferred, source: "inferred" };
  }

  if (!defaultBranch) {
    return null;
  }
  if (normalizeLocalBranchRefName(defaultBranch) !== currentBranch) {
    return { ref: defaultBranch, source: "default" };
  }

  // Standing on the default branch. `origin/<branch>` is the only comparison that says anything.
  const originRef = `origin/${currentBranch}`;
  if (await doesGitRefExist(cwd, `refs/remotes/origin/${currentBranch}`, context)) {
    return { ref: originRef, source: "default" };
  }
  return { ref: defaultBranch, source: "default" };
}

/**
 * Persisting happens on a read path, so it must never be the reason a read fails, and it must not
 * write nonsense during a transient repository state.
 *
 * The guard is that HEAD resolves to a real commit: an unborn or half-written HEAD means the repo
 * is mid-clone or mid-rebase, and a base recorded then would stick around long after the repo
 * settled.
 */
function persistDetectedBaseRef(
  worktreeRoot: string,
  currentBranch: string,
  ref: string,
  context?: CheckoutContext,
): void {
  try {
    writeStoredDiffBaseForBranch(worktreeRoot, currentBranch, { ref, source: "inferred" });
  } catch (error) {
    context?.logger?.trace(
      { err: error, worktreeRoot, currentBranch, ref },
      "failed to remember detected diff base",
    );
  }
}

/**
 * Re-points a remembered base whose branch has gone away.
 *
 * The case is ordinary: you stack on a parent branch, the parent merges, someone deletes it, and
 * now the stored base names a ref that resolves to nothing — every diff against it would fail.
 * Re-resolve to the repository default *once* and write that down, so this costs one extra
 * resolution rather than repeating forever.
 *
 * Returns the entry to use, or `null` when the caller should fall through the rest of the ladder.
 */
async function healRememberedBaseRef(
  cwd: string,
  input: {
    worktreeRoot: string;
    currentBranch: string;
    remembered: { ref: string; source: DiffBaseSource };
    context?: CheckoutContext;
  },
): Promise<{ ref: string; source: CheckoutBaseSource } | null> {
  const { worktreeRoot, currentBranch, remembered, context } = input;
  if (await baseRefStillExists(cwd, remembered.ref, context)) {
    return { ref: remembered.ref, source: remembered.source };
  }

  // Only heal against a repo that can actually answer. Mid-fetch or mid-clone every ref lookup
  // fails, and healing then would trade a good base for the default branch permanently.
  const currentBranchExists = await doesGitRefExist(
    cwd,
    `refs/heads/${currentBranch}`,
    context,
  ).catch(() => false);
  if (!currentBranchExists) {
    return { ref: remembered.ref, source: remembered.source };
  }

  const defaultBranch = await resolveBaseRef(cwd).catch(() => null);
  if (!defaultBranch || normalizeLocalBranchRefName(defaultBranch) === currentBranch) {
    try {
      clearStoredDiffBaseForBranch(worktreeRoot, currentBranch);
    } catch {
      // Falling through the ladder is correct either way; the stale entry is simply retried.
    }
    return null;
  }

  persistDetectedBaseRef(worktreeRoot, currentBranch, defaultBranch, context);
  return { ref: defaultBranch, source: "inferred" };
}

/** True when either side of `<name>` / `origin/<name>` still resolves. */
async function baseRefStillExists(
  cwd: string,
  baseRef: string,
  context?: CheckoutContext,
): Promise<boolean> {
  const localName = normalizeLocalBranchRefName(baseRef);
  if (!localName) {
    return false;
  }
  if (isRemoteQualifiedBaseRef(baseRef)) {
    // A remote-qualified pin is only satisfied by the remote ref; falling back to the local
    // branch would silently change which commits the diff covers.
    return doesGitRefExist(cwd, `refs/remotes/origin/${localName}`, context).catch(() => false);
  }
  const [hasLocal, hasOrigin] = await Promise.all([
    doesGitRefExist(cwd, `refs/heads/${localName}`, context).catch(() => false),
    doesGitRefExist(cwd, `refs/remotes/origin/${localName}`, context).catch(() => false),
  ]);
  return hasLocal || hasOrigin;
}

function isRemoteQualifiedBaseRef(baseRef: string): boolean {
  return baseRef.startsWith("origin/") || baseRef.startsWith("refs/remotes/origin/");
}

/**
 * Whether a caller-supplied base contradicts one the user (or worktree creation) chose on purpose.
 *
 * The point of rejecting a mismatch is that an explicit base is a contract: a client holding a
 * stale snapshot should fail loudly rather than quietly diff against something else. That only
 * applies to a base someone actually chose. A detected parent or the repository default is this
 * daemon's own guess, and a one-shot `baseRef` on the request is allowed to override a guess —
 * otherwise every ad-hoc comparison would break the moment detection started remembering answers.
 */
function isExplicitBaseRefMismatch(input: {
  storedBaseRef: string | null;
  baseSource: CheckoutBaseSource | null;
  requestedBaseRef: string | undefined;
}): boolean {
  const { storedBaseRef, baseSource, requestedBaseRef } = input;
  if (!storedBaseRef || !requestedBaseRef) {
    return false;
  }
  if (baseSource !== "user" && baseSource !== "worktree") {
    return false;
  }
  return requestedBaseRef !== storedBaseRef;
}

async function isWorkingTreeDirty(cwd: string, context?: CheckoutContext): Promise<boolean> {
  const { stdout } = await runGitCommand(["status", "--porcelain"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    logger: context?.logger,
  });
  return stdout.trim().length > 0;
}

export async function getOriginRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["config", "--get", "remote.origin.url"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const url = stdout.trim();
    return url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

export async function hasOriginRemote(cwd: string): Promise<boolean> {
  const url = await getOriginRemoteUrl(cwd);
  return url !== null;
}

async function getGitConfigValue(
  cwd: string,
  key: string,
  context?: CheckoutContext,
): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["config", "--get", key], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      logger: context?.logger,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function getGitRemotePushUrl(
  cwd: string,
  remoteName: string,
  context?: CheckoutContext,
): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["remote", "get-url", "--push", remoteName], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      logger: context?.logger,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function parseBranchMergeHeadRef(mergeRef: string | null): string | null {
  const prefix = "refs/heads/";
  if (!mergeRef?.startsWith(prefix)) {
    return null;
  }
  const headRef = mergeRef.slice(prefix.length).trim();
  return headRef.length > 0 ? headRef : null;
}

async function resolvePullRequestStatusLookupTarget(
  cwd: string,
  currentBranch: string,
  context?: CheckoutContext,
): Promise<PullRequestStatusLookupTarget> {
  if (context?.facts?.isGit && context.facts.pullRequestLookupTarget) {
    return context.facts.pullRequestLookupTarget;
  }
  const branchRemoteName = await getGitConfigValue(cwd, `branch.${currentBranch}.remote`, context);
  let branchMergeRef: string | null = null;
  if (branchRemoteName) {
    branchMergeRef = await getGitConfigValue(cwd, `branch.${currentBranch}.merge`, context);
  }

  const localBranchTarget = buildPullRequestLookupTargetFromBranchConfig({
    currentBranch,
    branchRemoteName,
    branchMergeRef,
    branchRemoteUrl: null,
    originRemoteUrl: null,
    resolvedBaseRef: null,
  });
  if (localBranchTarget.headRef === currentBranch) {
    const pushTarget = await resolvePullRequestLookupTargetFromPushConfig(
      cwd,
      currentBranch,
      null,
      null,
      context,
    );
    return pushTarget ?? localBranchTarget;
  }

  const [branchRemoteUrl, originRemoteUrl, resolvedBaseRef] = await Promise.all([
    branchRemoteName ? getGitConfigValue(cwd, `remote.${branchRemoteName}.url`, context) : null,
    getGitConfigValue(cwd, "remote.origin.url", context),
    getResolvedBaseRefForCwd(cwd, context),
  ]);
  const branchTarget = buildPullRequestLookupTargetFromBranchConfig({
    currentBranch,
    branchRemoteName,
    branchMergeRef,
    branchRemoteUrl,
    originRemoteUrl,
    resolvedBaseRef,
  });
  if (branchTarget.headRef !== currentBranch || branchTarget.headRepositoryOwner) {
    return branchTarget;
  }
  const pushTarget = await resolvePullRequestLookupTargetFromPushConfig(
    cwd,
    currentBranch,
    originRemoteUrl,
    resolvedBaseRef,
    context,
  );
  return pushTarget ?? branchTarget;
}

export async function resolveAbsoluteGitDir(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["rev-parse", "--absolute-git-dir"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const gitDir = stdout.trim();
    return gitDir.length > 0 ? gitDir : null;
  } catch {
    return null;
  }
}

async function resolveGitCommonDir(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["rev-parse", "--git-common-dir"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    return resolveGitRevParsePath(cwd, stdout);
  } catch {
    return null;
  }
}

async function abortGitPullConflictState(cwd: string): Promise<void> {
  const gitDir = await resolveAbsoluteGitDir(cwd);
  if (!gitDir) {
    return;
  }

  const mergeHeadPath = resolve(gitDir, "MERGE_HEAD");
  const rebaseMergePath = resolve(gitDir, "rebase-merge");
  const rebaseApplyPath = resolve(gitDir, "rebase-apply");

  if (existsSync(mergeHeadPath)) {
    try {
      await runGitCommand(["merge", "--abort"], { cwd, timeout: 120_000 });
    } catch {
      // ignore
    }
  }

  if (existsSync(rebaseMergePath) || existsSync(rebaseApplyPath)) {
    try {
      await runGitCommand(["rebase", "--abort"], { cwd, timeout: 120_000 });
    } catch {
      // ignore
    }
  }
}

export async function resolveRepositoryDefaultBranch(repoRoot: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      {
        cwd: repoRoot,
        envOverlay: READ_ONLY_GIT_ENV,
      },
    );
    const ref = stdout.trim();
    if (ref) {
      // Prefer a local branch name (e.g. "main") over the remote-tracking ref (e.g. "origin/main")
      // so that status/diff/merge all operate against the same base ref.
      const remoteShort = ref.replace(/^refs\/remotes\//, "");
      const localName = remoteShort.startsWith("origin/")
        ? remoteShort.slice("origin/".length)
        : remoteShort;
      try {
        await runGitCommand(["show-ref", "--verify", "--quiet", `refs/heads/${localName}`], {
          cwd: repoRoot,
          envOverlay: READ_ONLY_GIT_ENV,
        });
        return localName;
      } catch {
        return remoteShort;
      }
    }
  } catch {
    // ignore
  }

  const { stdout } = await runGitCommand(["branch", "--format=%(refname:short)"], {
    cwd: repoRoot,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  const branches = new Set(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );

  if (branches.has("main")) {
    return "main";
  }
  if (branches.has("master")) {
    return "master";
  }

  return null;
}

async function resolveBaseRef(repoRoot: string): Promise<string | null> {
  return resolveRepositoryDefaultBranch(repoRoot);
}

function normalizeLocalBranchRefName(input: string): string {
  if (input.startsWith("refs/remotes/origin/")) {
    return input.slice("refs/remotes/origin/".length);
  }
  if (input.startsWith("refs/heads/")) {
    return input.slice("refs/heads/".length);
  }
  if (input.startsWith("origin/")) {
    return input.slice("origin/".length);
  }
  return input;
}

interface ComparisonBaseRefName {
  localName: string;
  originRef: string;
}

function normalizeComparisonBaseRefName(input: string): ComparisonBaseRefName {
  const localName = normalizeLocalBranchRefName(input);
  return { localName, originRef: `origin/${localName}` };
}

async function doesGitRefExist(
  cwd: string,
  fullRef: string,
  context?: CheckoutContext,
): Promise<boolean> {
  const result = await runGitCommand(["show-ref", "--verify", "--quiet", fullRef], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 1],
    logger: context?.logger,
  });
  return result.exitCode === 0;
}

async function isAncestorCommit(
  cwd: string,
  ancestor: string,
  descendant: string,
  context?: CheckoutContext,
): Promise<boolean> {
  const result = await runGitCommand(["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 1],
    logger: context?.logger,
  });
  return result.exitCode === 0;
}

/**
 * Every comparison consumer (diff, ahead/behind, shortstat) funnels through this so they all
 * agree on which side of `<name>` / `origin/<name>` the Changes view is measured against.
 *
 * The two refs routinely disagree: local can be behind origin (nobody pulled) or ahead of it
 * (nobody pushed), and on a long-lived repo they can outright diverge. Picking the wrong side
 * drags the *base branch's own* commits into the view as if the user had written them.
 */
async function resolveBestComparisonBaseRef(
  cwd: string,
  baseRef: string,
  context?: CheckoutContext,
): Promise<string> {
  const normalized = normalizeComparisonBaseRefName(baseRef);
  const [hasLocal, hasOrigin] = await Promise.all([
    doesGitRefExist(cwd, `refs/heads/${normalized.localName}`, context),
    doesGitRefExist(cwd, `refs/remotes/origin/${normalized.localName}`, context),
  ]);

  // A remote-qualified base is a pin, not a hint. `main` and `origin/main` are different answers
  // whenever local and origin have drifted, and the user can now choose between them explicitly,
  // so honour the qualifier verbatim rather than letting the fork-point heuristic re-pick a side.
  // If the pinned remote ref has since disappeared, fall through instead of failing the view.
  if (isRemoteQualifiedBaseRef(baseRef) && hasOrigin) {
    return normalized.originRef;
  }

  if (hasLocal && hasOrigin) {
    return resolveLatestForkPointBaseRef(cwd, normalized, context);
  }
  if (hasOrigin) {
    return normalized.originRef;
  }
  if (hasLocal) {
    return normalized.localName;
  }

  const refName =
    baseRef.startsWith("origin/") || baseRef.startsWith("refs/remotes/origin/")
      ? normalized.originRef
      : normalized.localName;
  throw new Error(`Base branch not found locally or on origin: ${refName}`);
}

/**
 * Choose between `<name>` and `origin/<name>` by asking which one HEAD actually forked from:
 * the candidate whose merge-base with HEAD is the *later* commit. That merge-base is the real
 * branch point, so nothing the branch didn't author can leak into the diff — which is the whole
 * failure mode of diffing against a base ref that has drifted from where the work started.
 *
 * When both fork at the same commit the choice cannot change the diff, so fall through to the
 * more-advanced ref, which keeps the ahead/behind counts honest.
 */
async function resolveLatestForkPointBaseRef(
  cwd: string,
  normalized: ComparisonBaseRefName,
  context?: CheckoutContext,
): Promise<string> {
  const [localForkPoint, originForkPoint] = await Promise.all([
    tryResolveMergeBase(cwd, normalized.localName),
    tryResolveMergeBase(cwd, normalized.originRef),
  ]);

  if (localForkPoint && originForkPoint && localForkPoint !== originForkPoint) {
    if (await isAncestorCommit(cwd, originForkPoint, localForkPoint, context)) {
      return normalized.localName;
    }
    if (await isAncestorCommit(cwd, localForkPoint, originForkPoint, context)) {
      return normalized.originRef;
    }
  }

  return pickMoreAdvancedBaseRef(cwd, normalized.localName, context);
}

/** Prefers whichever of `<name>` / `origin/<name>` carries more commits the other lacks. */
async function pickMoreAdvancedBaseRef(
  cwd: string,
  normalizedBaseRef: string,
  context?: CheckoutContext,
): Promise<string> {
  const { stdout } = await runGitCommand(
    ["rev-list", "--left-right", "--count", `${normalizedBaseRef}...origin/${normalizedBaseRef}`],
    { cwd, envOverlay: READ_ONLY_GIT_ENV, logger: context?.logger },
  );
  const [localOnlyRaw, originOnlyRaw] = stdout.trim().split(/\s+/);
  const localOnly = Number.parseInt(localOnlyRaw ?? "0", 10);
  const originOnly = Number.parseInt(originOnlyRaw ?? "0", 10);
  if (Number.isNaN(localOnly) || Number.isNaN(originOnly)) {
    return normalizedBaseRef;
  }
  if (originOnly > localOnly) {
    return `origin/${normalizedBaseRef}`;
  }

  return normalizedBaseRef;
}

/**
 * Merge/pull targets want the freshest base ref, not the fork point — merging into a stale ref
 * would silently drop the other side's commits. Keep this separate from the comparison resolver.
 */
async function resolveMostAheadBaseRef(cwd: string, normalizedBaseRef: string): Promise<string> {
  const [hasLocal, hasOrigin] = await Promise.all([
    doesGitRefExist(cwd, `refs/heads/${normalizedBaseRef}`),
    doesGitRefExist(cwd, `refs/remotes/origin/${normalizedBaseRef}`),
  ]);

  if (hasLocal && !hasOrigin) {
    return normalizedBaseRef;
  }
  if (!hasLocal && hasOrigin) {
    return `origin/${normalizedBaseRef}`;
  }
  if (!hasLocal && !hasOrigin) {
    throw new Error(`Base branch not found locally or on origin: ${normalizedBaseRef}`);
  }

  return pickMoreAdvancedBaseRef(cwd, normalizedBaseRef);
}

async function getAheadBehind(
  cwd: string,
  baseRef: string,
  currentBranch: string,
  context?: CheckoutContext,
): Promise<AheadBehind | null> {
  const normalizedBaseRef = normalizeLocalBranchRefName(baseRef);
  if (!normalizedBaseRef || !currentBranch || normalizedBaseRef === currentBranch) {
    return null;
  }
  const comparisonBaseRef =
    context?.facts?.isGit && context.facts.resolvedBaseRef === baseRef
      ? context.facts.comparisonBaseRef
      : await resolveBestComparisonBaseRef(cwd, baseRef, context);
  if (!comparisonBaseRef) {
    return null;
  }
  const { stdout } = await runGitCommand(
    ["rev-list", "--left-right", "--count", `${comparisonBaseRef}...${currentBranch}`],
    { cwd, envOverlay: READ_ONLY_GIT_ENV, logger: context?.logger },
  );
  const [behindRaw, aheadRaw] = stdout.trim().split(/\s+/);
  const behind = Number.parseInt(behindRaw ?? "0", 10);
  const ahead = Number.parseInt(aheadRaw ?? "0", 10);
  if (Number.isNaN(behind) || Number.isNaN(ahead)) {
    return null;
  }
  return { ahead, behind };
}

async function getAheadOfOrigin(
  cwd: string,
  currentBranch: string,
  context?: CheckoutContext,
): Promise<number | null> {
  if (!currentBranch) {
    return null;
  }
  const upstreamRef = await getConfiguredUpstreamRef(cwd, currentBranch, context);
  if (!upstreamRef) {
    return null;
  }
  try {
    const { stdout } = await runGitCommand(
      ["rev-list", "--count", `${upstreamRef}..${currentBranch}`],
      { cwd, envOverlay: READ_ONLY_GIT_ENV, logger: context?.logger },
    );
    const count = Number.parseInt(stdout.trim(), 10);
    return Number.isNaN(count) ? null : count;
  } catch {
    return null;
  }
}

async function getConfiguredUpstreamRef(
  cwd: string,
  currentBranch: string,
  context?: CheckoutContext,
): Promise<string | null> {
  const remoteName =
    context?.facts?.isGit && context.facts.currentBranch === currentBranch
      ? context.facts.branchRemoteName
      : await getGitConfigValue(cwd, `branch.${currentBranch}.remote`, context);
  if (!remoteName) {
    return null;
  }

  const mergeRef =
    context?.facts?.isGit && context.facts.currentBranch === currentBranch
      ? context.facts.branchMergeRef
      : await getGitConfigValue(cwd, `branch.${currentBranch}.merge`, context);
  const upstreamBranch = parseBranchMergeHeadRef(mergeRef);
  return upstreamBranch ? `${remoteName}/${upstreamBranch}` : null;
}

async function getBehindOfOrigin(
  cwd: string,
  currentBranch: string,
  context?: CheckoutContext,
): Promise<number | null> {
  if (!currentBranch) {
    return null;
  }
  const upstreamRef = await getConfiguredUpstreamRef(cwd, currentBranch, context);
  if (!upstreamRef) {
    return null;
  }
  try {
    const { stdout } = await runGitCommand(
      ["rev-list", "--count", `${currentBranch}..${upstreamRef}`],
      { cwd, envOverlay: READ_ONLY_GIT_ENV, logger: context?.logger },
    );
    const count = Number.parseInt(stdout.trim(), 10);
    return Number.isNaN(count) ? null : count;
  } catch {
    return null;
  }
}

interface CheckoutInspectionContext {
  worktreeRoot: string;
  currentBranch: string | null;
  remoteUrl: string | null;
  absoluteGitDir: string | null;
  gitCommonDir: string | null;
  ottoWorktree: OttoWorktreeForCwd;
}

async function inspectCheckoutContext(
  cwd: string,
  context?: CheckoutContext,
): Promise<CheckoutInspectionContext | null> {
  try {
    const root = await getWorktreeRoot(cwd, context);
    if (!root) {
      return null;
    }

    const [currentBranch, remoteUrl, absoluteGitDir, gitCommonDir, ottoWorktree] =
      await Promise.all([
        getCurrentBranch(cwd),
        getOriginRemoteUrl(cwd),
        resolveAbsoluteGitDir(cwd),
        resolveGitCommonDir(cwd),
        getOttoWorktreeForCwd(cwd, context, root),
      ]);

    return {
      worktreeRoot: root,
      currentBranch,
      remoteUrl,
      absoluteGitDir,
      gitCommonDir,
      ottoWorktree,
    };
  } catch (error) {
    if (isGitError(error)) {
      return null;
    }
    throw error;
  }
}

// The worktree's own record of which change request it was cut for. It wins over
// branch config because that config cannot describe a cross-repo MR whose head
// branch was never pushed to this remote, or a worktree whose local branch had to
// be uniquified away from the head ref.
function buildPullRequestLookupTargetFromMetadata(
  worktreeRoot: string | null,
): PullRequestStatusLookupTarget | null {
  if (!worktreeRoot) {
    return null;
  }
  const target = readOttoWorktreeMetadata(worktreeRoot)?.changeRequestLookupTarget;
  if (!target) {
    return null;
  }
  return {
    headRef: target.headRef,
    ...(target.headRepositoryOwner ? { headRepositoryOwner: target.headRepositoryOwner } : {}),
  };
}

function buildPullRequestLookupTargetFromBranchConfig(
  input: PullRequestLookupTargetBranchConfig,
): PullRequestStatusLookupTarget {
  const trackedHeadRef = parseBranchMergeHeadRef(input.branchMergeRef);
  if (!input.branchRemoteName || !trackedHeadRef || trackedHeadRef === input.currentBranch) {
    return { headRef: input.currentBranch };
  }

  const remoteRepo = input.branchRemoteUrl
    ? parseGitHubRepoFromRemote(input.branchRemoteUrl)
    : null;
  const originRepo = input.originRemoteUrl
    ? parseGitHubRepoFromRemote(input.originRemoteUrl)
    : null;
  const isSameRepo = Boolean(remoteRepo && originRepo && remoteRepo === originRepo);
  const headRepositoryOwner = remoteRepo && !isSameRepo ? remoteRepo.split("/")[0] : null;
  const normalizedBaseRef = input.resolvedBaseRef
    ? normalizeLocalBranchRefName(input.resolvedBaseRef)
    : null;
  if (trackedHeadRef === normalizedBaseRef && !headRepositoryOwner) {
    return { headRef: input.currentBranch };
  }

  if (isSameRepo) {
    return { headRef: trackedHeadRef };
  }

  return {
    headRef: trackedHeadRef,
    ...(headRepositoryOwner ? { headRepositoryOwner } : {}),
  };
}

function buildPullRequestLookupTargetFromPushConfig(
  input: PullRequestLookupTargetPushConfig,
): PullRequestStatusLookupTarget | null {
  const pushedHeadRef = parseHeadPushRefspec(input.pushRefspec);
  if (!input.pushRemoteName || !pushedHeadRef || pushedHeadRef === input.currentBranch) {
    return null;
  }

  const remoteRepo = input.pushRemoteUrl ? parseGitHubRepoFromRemote(input.pushRemoteUrl) : null;
  const originRepo = input.originRemoteUrl
    ? parseGitHubRepoFromRemote(input.originRemoteUrl)
    : null;
  const isSameRepo = Boolean(remoteRepo && originRepo && remoteRepo === originRepo);
  const headRepositoryOwner = remoteRepo && !isSameRepo ? remoteRepo.split("/")[0] : null;
  const normalizedBaseRef = input.resolvedBaseRef
    ? normalizeLocalBranchRefName(input.resolvedBaseRef)
    : null;
  if (pushedHeadRef === normalizedBaseRef && !headRepositoryOwner) {
    return null;
  }

  return {
    headRef: pushedHeadRef,
    ...(headRepositoryOwner ? { headRepositoryOwner } : {}),
  };
}

async function resolvePullRequestLookupTargetFromPushConfig(
  cwd: string,
  currentBranch: string,
  knownOriginRemoteUrl: string | null,
  knownResolvedBaseRef: string | null,
  context?: CheckoutContext,
): Promise<PullRequestStatusLookupTarget | null> {
  const pushRemoteName = await getGitConfigValue(
    cwd,
    `branch.${currentBranch}.pushRemote`,
    context,
  );
  if (!pushRemoteName) {
    return null;
  }

  const [pushRefspec, pushRemoteUrl, originRemoteUrl, resolvedBaseRef] = await Promise.all([
    getGitConfigValue(cwd, `remote.${pushRemoteName}.push`, context),
    getGitConfigValue(cwd, `remote.${pushRemoteName}.url`, context),
    knownOriginRemoteUrl === null ? getGitConfigValue(cwd, "remote.origin.url", context) : null,
    knownResolvedBaseRef === null ? getResolvedBaseRefForCwd(cwd, context) : null,
  ]);
  return buildPullRequestLookupTargetFromPushConfig({
    currentBranch,
    pushRemoteName,
    pushRefspec,
    pushRemoteUrl,
    originRemoteUrl: knownOriginRemoteUrl ?? originRemoteUrl,
    resolvedBaseRef: knownResolvedBaseRef ?? resolvedBaseRef,
  });
}

export async function getCheckoutSnapshotFacts(
  cwd: string,
  context?: CheckoutContext,
): Promise<CheckoutSnapshotFacts> {
  if (context?.facts) {
    return context.facts;
  }

  const inspected = await inspectCheckoutContext(cwd, context);
  if (!inspected) {
    return { isGit: false };
  }

  const { storedBaseRef, resolvedBaseRef, baseSource } = await resolveBaseRefLadder(cwd, {
    worktreeRoot: inspected.worktreeRoot,
    currentBranch: inspected.currentBranch,
    ottoWorktree: inspected.ottoWorktree,
    context,
  });
  const mainRepoRoot = await getMainRepoRootFromCommonDir(
    cwd,
    inspected.gitCommonDir,
    context,
  ).catch(() => null);
  let comparisonBaseRef: string | null = null;
  if (
    resolvedBaseRef &&
    inspected.currentBranch &&
    normalizeLocalBranchRefName(resolvedBaseRef) !== inspected.currentBranch
  ) {
    comparisonBaseRef = await resolveBestComparisonBaseRef(cwd, resolvedBaseRef, context).catch(
      () => null,
    );
  }

  let branchRemoteName: string | null = null;
  let branchMergeRef: string | null = null;
  let branchRemoteUrl: string | null = null;
  if (inspected.currentBranch) {
    branchRemoteName = await getGitConfigValue(
      cwd,
      `branch.${inspected.currentBranch}.remote`,
      context,
    );
    if (branchRemoteName) {
      [branchMergeRef, branchRemoteUrl] = await Promise.all([
        getGitConfigValue(cwd, `branch.${inspected.currentBranch}.merge`, context),
        getGitConfigValue(cwd, `remote.${branchRemoteName}.url`, context),
      ]);
    }
  }
  let pullRequestLookupTarget = inspected.currentBranch
    ? (buildPullRequestLookupTargetFromMetadata(
        inspected.ottoWorktree.isOttoOwnedWorktree ? inspected.ottoWorktree.worktreeRoot : null,
      ) ??
      buildPullRequestLookupTargetFromBranchConfig({
        currentBranch: inspected.currentBranch,
        branchRemoteName,
        branchMergeRef,
        branchRemoteUrl,
        originRemoteUrl: inspected.remoteUrl,
        resolvedBaseRef,
      }))
    : null;
  if (
    inspected.currentBranch &&
    pullRequestLookupTarget?.headRef === inspected.currentBranch &&
    !pullRequestLookupTarget.headRepositoryOwner
  ) {
    pullRequestLookupTarget =
      (await resolvePullRequestLookupTargetFromPushConfig(
        cwd,
        inspected.currentBranch,
        inspected.remoteUrl,
        resolvedBaseRef,
        context,
      )) ?? pullRequestLookupTarget;
  }

  return {
    isGit: true,
    worktreeRoot: inspected.worktreeRoot,
    currentBranch: inspected.currentBranch,
    remoteUrl: inspected.remoteUrl,
    absoluteGitDir: inspected.absoluteGitDir,
    gitCommonDir: inspected.gitCommonDir,
    ottoWorktree: inspected.ottoWorktree,
    storedBaseRef,
    resolvedBaseRef,
    baseSource,
    mainRepoRoot,
    comparisonBaseRef,
    branchRemoteName,
    branchMergeRef,
    pullRequestLookupTarget,
  };
}

const PER_FILE_DIFF_MAX_BYTES = 1024 * 1024; // 1MB
const TOTAL_DIFF_MAX_BYTES = 2 * 1024 * 1024; // 2MB
const UNTRACKED_BINARY_SNIFF_BYTES = 16 * 1024;

async function isLikelyBinaryFile(absolutePath: string): Promise<boolean> {
  const handle = await openFile(absolutePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(UNTRACKED_BINARY_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0) {
      return false;
    }

    let suspicious = 0;
    for (let i = 0; i < bytesRead; i += 1) {
      const byte = buffer[i];
      if (byte === 0) {
        return true;
      }
      // Treat control bytes as suspicious while allowing common whitespace.
      if (byte < 7 || (byte > 14 && byte < 32) || byte === 127) {
        suspicious += 1;
      }
    }

    return suspicious / bytesRead > 0.3;
  } finally {
    await handle.close();
  }
}

async function inspectUntrackedFile(
  cwd: string,
  relativePath: string,
): Promise<{ stat: FileStat; truncated: boolean }> {
  const absolutePath = resolve(cwd, relativePath);
  const metadata = await statFile(absolutePath);

  if (!metadata.isFile()) {
    return { stat: null, truncated: false };
  }

  if (await isLikelyBinaryFile(absolutePath)) {
    return {
      stat: { additions: 0, deletions: 0, isBinary: true },
      truncated: false,
    };
  }

  if (metadata.size > PER_FILE_DIFF_MAX_BYTES) {
    return {
      stat: { additions: 0, deletions: 0, isBinary: false },
      truncated: true,
    };
  }

  return {
    stat: { additions: 0, deletions: 0, isBinary: false },
    truncated: false,
  };
}

function buildPlaceholderParsedDiffFile(
  change: CheckoutFileChange,
  options: { status: "too_large" | "binary"; stat?: FileStat },
): ParsedDiffFile {
  return {
    path: change.path,
    isNew: change.isNew,
    isDeleted: change.isDeleted,
    additions: options.stat?.additions ?? 0,
    deletions: options.stat?.deletions ?? 0,
    hunks: [],
    status: options.status,
  };
}

async function getUntrackedDiffText(
  cwd: string,
  change: CheckoutFileChange,
  ignoreWhitespace = false,
): Promise<{ text: string; truncated: boolean; stat: FileStat }> {
  try {
    const inspected = await inspectUntrackedFile(cwd, change.path);
    if (inspected.stat?.isBinary || inspected.truncated) {
      return { text: "", truncated: inspected.truncated, stat: inspected.stat };
    }
  } catch {
    // Fall through to git diff path if metadata probing fails.
  }

  const result = await runGitCommand(
    buildGitDiffArgs({
      ignoreWhitespace,
      extra: ["--no-index", "/dev/null", "--", change.path],
    }),
    {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      maxOutputBytes: PER_FILE_DIFF_MAX_BYTES,
      acceptExitCodes: [0, 1],
    },
  );
  return {
    text: result.stdout,
    truncated: result.truncated,
    stat: { additions: 0, deletions: 0, isBinary: false },
  };
}

export interface SetCheckoutBaseRefResult {
  baseRef: string;
  /** True when the write reset the worktree back to the repository default branch. */
  isDefault: boolean;
  /** Where the resulting base came from, so the client can label it without a refetch. */
  source: CheckoutBaseSource;
}

export interface SetCheckoutBaseRefOptions {
  /**
   * Forget this branch's remembered base and let the resolution ladder detect its parent again,
   * rather than pinning a branch.
   *
   * This is the escape hatch for a wrong inference. Parent detection is a heuristic over a graph
   * that does not record the answer, and stickiness makes a wrong guess persistent, so there has
   * to be a way to ask for it again after the branch topology changes.
   */
  redetect?: boolean;
}

/**
 * Repoints an Otto worktree's stored base branch. `baseRef: null` resets to the repository
 * default.
 *
 * "Diff against the default branch" is the wrong question for a stacked branch — the parent
 * branch's commits are not the child's work, but they sit between the default branch and HEAD,
 * so they show up in the child's Changes view. Pointing the base at the parent is what a forge
 * PR does implicitly by carrying an explicit base, and it is what this makes local.
 */
export async function setCheckoutBaseRef(
  cwd: string,
  baseRef: string | null,
  context?: CheckoutContext,
  options?: SetCheckoutBaseRefOptions,
): Promise<SetCheckoutBaseRefResult> {
  const facts = await getCheckoutSnapshotFacts(cwd, context);
  if (!facts.isGit) {
    throw new NotGitRepoError(cwd);
  }
  const currentBranch = facts.currentBranch;

  if (options?.redetect) {
    return redetectCheckoutBaseRef(cwd, { facts, currentBranch, context });
  }

  const isDefault = baseRef === null;
  let requested = baseRef;
  if (requested === null) {
    requested = await resolveRepositoryDefaultBranch(cwd);
    if (!requested) {
      throw new Error("Unable to determine the repository's default branch");
    }
  }

  // Keeps an `origin/` qualifier: the user can pin the remote-tracking side deliberately, and
  // stripping it here would silently collapse that choice back to the local branch.
  const normalized = validateBaseRefNameAllowingRemote(requested);
  if (normalizeLocalBranchRefName(normalized) === currentBranch) {
    throw new Error("Base branch cannot be the branch you are on");
  }
  // Resolving proves the ref exists locally or on origin, and throws the same
  // "not found" message the comparison path would have produced later.
  await resolveBestComparisonBaseRef(cwd, normalized, context);

  if (facts.ottoWorktree.isOttoOwnedWorktree) {
    // The worktree's own record stays authoritative for merge-into-base and PR creation, so it
    // has to carry the local branch name — there is no opening a PR against a remote-tracking ref.
    setOttoWorktreeBaseRefName(
      facts.ottoWorktree.worktreeRoot,
      normalizeAndValidateBaseRefName(normalized),
    );
  }
  // Recorded per branch either way. This is what makes the picker work on a plain checkout, whose
  // gitdir is shared by every branch in it, and it is what pins the `origin/` qualifier.
  if (currentBranch) {
    writeStoredDiffBaseForBranch(facts.worktreeRoot, currentBranch, {
      ref: normalized,
      source: "user",
    });
  }

  invalidateBaseRefDependentCaches(cwd);
  return { baseRef: normalized, isDefault, source: "user" };
}

/** Drops the remembered base and runs the resolution ladder again from scratch. */
async function redetectCheckoutBaseRef(
  cwd: string,
  input: {
    facts: Extract<CheckoutSnapshotFacts, { isGit: true }>;
    currentBranch: string | null;
    context?: CheckoutContext;
  },
): Promise<SetCheckoutBaseRefResult> {
  const { facts, currentBranch, context } = input;
  if (!currentBranch) {
    throw new Error("Unable to determine the current branch");
  }

  clearStoredDiffBaseForBranch(facts.worktreeRoot, currentBranch);
  invalidateBaseRefDependentCaches(cwd);

  // Deliberately not passing `facts` through: they carry the base we just discarded.
  const redetected = await resolveBaseRefLadder(cwd, {
    worktreeRoot: facts.worktreeRoot,
    currentBranch,
    ottoWorktree: facts.ottoWorktree,
    ...(context?.logger ? { context: { logger: context.logger } } : {}),
  });
  if (!redetected.resolvedBaseRef) {
    throw new Error("Unable to detect a base branch for this branch");
  }
  return {
    baseRef: redetected.resolvedBaseRef,
    isDefault: redetected.baseSource === "default",
    source: redetected.baseSource ?? "inferred",
  };
}

function invalidateBaseRefDependentCaches(cwd: string): void {
  shortstatCache.delete(getShortstatCacheKey(cwd));
  pullRequestStatusCache.clear();
}

export async function getCheckoutStatus(
  cwd: string,
  context?: CheckoutContext,
): Promise<CheckoutStatusResult> {
  const facts = await getCheckoutSnapshotFacts(cwd, context);
  if (!facts.isGit) {
    return { isGit: false };
  }

  const worktreeRoot = facts.worktreeRoot;
  const currentBranch = facts.currentBranch;
  const remoteUrl = facts.remoteUrl;
  const ottoWorktree = facts.ottoWorktree;
  const isDirty = await isWorkingTreeDirty(cwd, context);
  const hasRemote = remoteUrl !== null;
  const baseRef = facts.resolvedBaseRef;
  const mainRepoRoot = facts.mainRepoRoot;
  const factsContext = { ...context, facts };
  const [aheadBehind, aheadOfOrigin, behindOfOrigin] = await Promise.all([
    baseRef && currentBranch
      ? getAheadBehind(cwd, baseRef, currentBranch, factsContext)
      : Promise.resolve(null),
    hasRemote && currentBranch
      ? getAheadOfOrigin(cwd, currentBranch, factsContext)
      : Promise.resolve(null),
    hasRemote && currentBranch
      ? getBehindOfOrigin(cwd, currentBranch, factsContext)
      : Promise.resolve(null),
  ]);

  if (ottoWorktree.isOttoOwnedWorktree && baseRef) {
    return {
      isGit: true,
      repoRoot: worktreeRoot,
      mainRepoRoot: mainRepoRoot ?? worktreeRoot,
      currentBranch,
      isDirty,
      baseRef,
      baseSource: facts.baseSource,
      aheadBehind,
      aheadOfOrigin,
      behindOfOrigin,
      hasRemote,
      remoteUrl,
      isOttoOwnedWorktree: true,
    };
  }

  return {
    isGit: true,
    repoRoot: worktreeRoot,
    mainRepoRoot:
      mainRepoRoot && resolve(mainRepoRoot) !== resolve(worktreeRoot) ? mainRepoRoot : null,
    currentBranch,
    isDirty,
    baseRef,
    baseSource: facts.baseSource,
    aheadBehind,
    aheadOfOrigin,
    behindOfOrigin,
    hasRemote,
    remoteUrl,
    isOttoOwnedWorktree: false,
  };
}

/**
 * The identity half of {@link CheckoutStatusResult}: who this checkout is, with
 * nothing about how far it has drifted.
 */
export type CheckoutIdentityResult =
  | { isGit: false }
  | {
      isGit: true;
      repoRoot: string;
      mainRepoRoot: string | null;
      currentBranch: string | null;
      remoteUrl: string | null;
      isOttoOwnedWorktree: boolean;
    };

/**
 * Identity-only checkout read: repo root, branch, remote and worktree ownership.
 *
 * `getCheckoutStatus` answers the same questions but pays for the whole drift
 * picture on the way — the base-ref ladder, `status --porcelain`, and three
 * `rev-list --count` walks — around 17 git spawns. Callers that keep only the
 * identity fields (periodic reconciliation is the big one) can use this instead
 * and pay for `inspectCheckoutContext` plus the common-dir resolve, roughly a
 * third of that. On Windows, where every spawn costs ~30-80 ms plus Defender
 * scanning, that difference is what keeps a reconciliation tick off the global
 * git limiter.
 */
export async function getCheckoutIdentity(
  cwd: string,
  context?: CheckoutContext,
): Promise<CheckoutIdentityResult> {
  // A caller that already resolved the full facts has paid for everything this
  // function would spawn; read from them rather than re-running git.
  const facts = context?.facts;
  if (facts) {
    if (!facts.isGit) {
      return { isGit: false };
    }
    return buildCheckoutIdentity({
      worktreeRoot: facts.worktreeRoot,
      currentBranch: facts.currentBranch,
      remoteUrl: facts.remoteUrl,
      mainRepoRoot: facts.mainRepoRoot,
      isOttoOwnedWorktree: facts.ottoWorktree.isOttoOwnedWorktree,
    });
  }

  const inspected = await inspectCheckoutContext(cwd, context);
  if (!inspected) {
    return { isGit: false };
  }
  const mainRepoRoot = await getMainRepoRootFromCommonDir(
    cwd,
    inspected.gitCommonDir,
    context,
  ).catch(() => null);

  return buildCheckoutIdentity({
    worktreeRoot: inspected.worktreeRoot,
    currentBranch: inspected.currentBranch,
    remoteUrl: inspected.remoteUrl,
    mainRepoRoot,
    isOttoOwnedWorktree: inspected.ottoWorktree.isOttoOwnedWorktree,
  });
}

function buildCheckoutIdentity(input: {
  worktreeRoot: string;
  currentBranch: string | null;
  remoteUrl: string | null;
  mainRepoRoot: string | null;
  isOttoOwnedWorktree: boolean;
}): CheckoutIdentityResult {
  // Same main-repo-root rule as getCheckoutStatus: an Otto worktree always
  // reports one (falling back to its own root), and a plain checkout reports one
  // only when it actually differs from where we are.
  let mainRepoRoot: string | null = null;
  if (input.isOttoOwnedWorktree) {
    mainRepoRoot = input.mainRepoRoot ?? input.worktreeRoot;
  } else if (input.mainRepoRoot && resolve(input.mainRepoRoot) !== resolve(input.worktreeRoot)) {
    mainRepoRoot = input.mainRepoRoot;
  }

  return {
    isGit: true,
    repoRoot: input.worktreeRoot,
    mainRepoRoot,
    currentBranch: input.currentBranch,
    remoteUrl: input.remoteUrl,
    isOttoOwnedWorktree: input.isOttoOwnedWorktree,
  };
}

export interface CheckoutShortstat {
  additions: number;
  deletions: number;
}

function parseCheckoutShortstat(text: string): CheckoutShortstat | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  let additions = 0;
  let deletions = 0;
  const addMatch = trimmed.match(/(\d+)\s+insertion/);
  if (addMatch) {
    additions = Number.parseInt(addMatch[1], 10);
  }
  const delMatch = trimmed.match(/(\d+)\s+deletion/);
  if (delMatch) {
    deletions = Number.parseInt(delMatch[1], 10);
  }

  if (additions === 0 && deletions === 0) {
    return null;
  }

  return { additions, deletions };
}

const UNTRACKED_SHORTSTAT_MAX_FILES = 500;

async function countUntrackedAdditions(cwd: string): Promise<number> {
  try {
    const { stdout } = await runGitCommand(["ls-files", "--others", "--exclude-standard"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const files = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    let additions = 0;
    for (const file of files.slice(0, UNTRACKED_SHORTSTAT_MAX_FILES)) {
      const absolutePath = resolve(cwd, file);
      try {
        const metadata = await statFile(absolutePath);
        if (metadata.size > PER_FILE_DIFF_MAX_BYTES) continue;
        if (await isLikelyBinaryFile(absolutePath)) continue;
        const content = await readFile(absolutePath, "utf-8");
        if (content.length === 0) continue;
        const normalized = content.replace(/\r\n/g, "\n");
        const lineCount = normalized.split("\n").length;
        additions += normalized.endsWith("\n") ? lineCount - 1 : lineCount;
      } catch {
        // Skip unreadable files.
      }
    }
    return additions;
  } catch {
    return 0;
  }
}

async function getCheckoutShortstatUncached(
  cwd: string,
  context?: CheckoutContext,
): Promise<CheckoutShortstat | null> {
  if (context?.facts?.isGit === false) {
    return null;
  }
  if (!context?.facts?.isGit) {
    try {
      await requireGitRepo(cwd);
    } catch {
      return null;
    }
  }

  const facts = context?.facts;
  const localBaseRef = facts?.isGit
    ? facts.resolvedBaseRef
    : await getResolvedBaseRefForCwd(cwd, context);
  const currentBranch = facts?.isGit ? facts.currentBranch : await getCurrentBranch(cwd);
  const comparisonRef = await resolveShortstatComparisonRef({
    cwd,
    currentBranch,
    localBaseRef,
    facts,
    context,
  });
  if (!comparisonRef) {
    return null;
  }

  try {
    const { stdout: mergeBaseOut } = await runGitCommand(["merge-base", "HEAD", comparisonRef], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const mergeBase = mergeBaseOut.trim();
    if (!mergeBase) {
      return null;
    }

    const [{ stdout }, untrackedAdditions] = await Promise.all([
      runGitCommand(["diff", "--shortstat", mergeBase], {
        cwd,
        envOverlay: READ_ONLY_GIT_ENV,
      }),
      countUntrackedAdditions(cwd),
    ]);

    const tracked = parseCheckoutShortstat(stdout);

    if (tracked) {
      return { additions: tracked.additions + untrackedAdditions, deletions: tracked.deletions };
    }
    if (untrackedAdditions > 0) {
      return { additions: untrackedAdditions, deletions: 0 };
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveShortstatComparisonRef(input: {
  cwd: string;
  currentBranch: string | null;
  localBaseRef: string | null;
  facts?: CheckoutSnapshotFacts | null;
  context?: CheckoutContext;
}): Promise<string | null> {
  const { cwd, currentBranch, localBaseRef, facts, context } = input;
  if (!currentBranch) {
    return null;
  }

  if (localBaseRef && currentBranch !== localBaseRef) {
    try {
      return facts?.isGit && facts.resolvedBaseRef === localBaseRef && facts.comparisonBaseRef
        ? facts.comparisonBaseRef
        : await resolveBestComparisonBaseRef(cwd, localBaseRef, context);
    } catch {
      return null;
    }
  }

  const hasOrigin = await doesGitRefExist(cwd, `refs/remotes/origin/${currentBranch}`, context);
  return hasOrigin ? `origin/${currentBranch}` : null;
}

function getOrLoadCheckoutShortstat(
  cwd: string,
  context?: CheckoutContext,
  options?: CheckoutReadCacheOptions,
): Promise<CheckoutShortstat | null> {
  const cacheKey = getShortstatCacheKey(cwd);
  if (!options?.force) {
    const cached = shortstatCache.get(cacheKey);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    const existing = shortstatInFlight.get(cacheKey);
    if (existing) {
      return existing;
    }
  }

  const load = getCheckoutShortstatUncached(cwd, context)
    .then((shortstat) => {
      shortstatCache.set(cacheKey, shortstat);
      return shortstat;
    })
    .finally(() => {
      shortstatInFlight.delete(cacheKey);
    });

  shortstatInFlight.set(cacheKey, load);
  return load;
}

export async function getCheckoutShortstat(
  cwd: string,
  context?: CheckoutContext,
  options?: CheckoutReadCacheOptions,
): Promise<CheckoutShortstat | null> {
  return getOrLoadCheckoutShortstat(cwd, context, options);
}

export function getCachedCheckoutShortstat(cwd: string): CheckoutShortstat | null | undefined {
  return shortstatCache.get(getShortstatCacheKey(cwd));
}

export function warmCheckoutShortstatInBackground(
  cwd: string,
  context?: CheckoutContext,
  onComplete?: () => void,
): void {
  const cacheKey = getShortstatCacheKey(cwd);
  if (shortstatCache.get(cacheKey) !== undefined || shortstatInFlight.has(cacheKey)) {
    return;
  }

  void getOrLoadCheckoutShortstat(cwd, context)
    .then(() => {
      onComplete?.();
      return;
    })
    .catch(() => {
      // Non-critical: keep listing path resilient even if git commands fail.
    });
}

interface AppendStructuredTrackedDiffsInput {
  cwd: string;
  trackedChanges: CheckoutFileChange[];
  trackedChangeByPath: Map<string, CheckoutFileChange>;
  trackedNumstatByPath: Map<string, FileStat>;
  trackedPlaceholderByPath: Map<string, { status: "binary" | "too_large"; stat: FileStat }>;
  trackedDiffText: string;
  refsForDiff: CheckoutDiffRefs;
  ignoreWhitespace: boolean;
  structured: ParsedDiffFile[];
  appendDiff: (text: string) => void;
  appendTrackedPlaceholderComment: (
    change: CheckoutFileChange,
    status: "binary" | "too_large",
  ) => void;
}

async function appendStructuredTrackedDiffs(
  input: AppendStructuredTrackedDiffsInput,
): Promise<void> {
  const {
    cwd,
    trackedChanges,
    trackedChangeByPath,
    trackedNumstatByPath,
    trackedPlaceholderByPath,
    trackedDiffText,
    refsForDiff,
    ignoreWhitespace,
    structured,
    appendTrackedPlaceholderComment,
  } = input;

  const parsedTrackedFiles =
    trackedDiffText.length > 0
      ? await parseAndHighlightDiff(trackedDiffText, cwd, {
          getOldFileContent: async (file) => {
            const change = trackedChangeByPath.get(file.path);
            if (!change || change.isNew) {
              return null;
            }
            const refPath = change.oldPath ?? change.path;
            return readGitFileContentAtRef(cwd, refsForDiff.baseRef, refPath);
          },
          getNewFileContent: async (file) => {
            if (!refsForDiff.targetRef) {
              return null;
            }
            return readGitFileContentAtRef(cwd, refsForDiff.targetRef, file.path);
          },
        })
      : [];
  const parsedTrackedByPath = new Map(parsedTrackedFiles.map((file) => [file.path, file]));

  for (const change of trackedChanges) {
    const placeholder = trackedPlaceholderByPath.get(change.path);
    if (placeholder) {
      structured.push(
        buildPlaceholderParsedDiffFile(change, {
          status: placeholder.status,
          stat: placeholder.stat,
        }),
      );
      appendTrackedPlaceholderComment(change, placeholder.status);
      continue;
    }

    const stat = trackedNumstatByPath.get(change.path) ?? null;
    const parsedFile = parsedTrackedByPath.get(change.path);
    if (parsedFile) {
      structured.push({
        ...parsedFile,
        path: change.path,
        isNew: change.isNew,
        isDeleted: change.isDeleted,
        status: "ok",
      });
      continue;
    }

    // `git diff -w --name-status` can still report a modified path even when the
    // whitespace-filtered patch and numstat are both empty. Skip emitting a
    // structured placeholder in that case so whitespace-only edits truly disappear.
    if (
      ignoreWhitespace &&
      change.status.startsWith("M") &&
      (!stat || (!stat.isBinary && stat.additions === 0 && stat.deletions === 0))
    ) {
      continue;
    }

    structured.push({
      path: change.path,
      isNew: change.isNew,
      isDeleted: change.isDeleted,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      hunks: [],
      status: "ok",
    });
  }
}

interface ProcessUntrackedChangeInput {
  cwd: string;
  change: CheckoutFileChange;
  ignoreWhitespace: boolean;
  includeStructured: boolean;
  structured: ParsedDiffFile[];
  appendDiff: (text: string) => void;
}

async function processUntrackedChange(input: ProcessUntrackedChangeInput): Promise<void> {
  const { cwd, change, ignoreWhitespace, includeStructured, structured, appendDiff } = input;
  const { text, truncated, stat } = await getUntrackedDiffText(cwd, change, ignoreWhitespace);

  if (!includeStructured) {
    if (stat?.isBinary) {
      appendDiff(`# ${change.path}: binary diff omitted\n`);
    } else if (truncated) {
      appendDiff(`# ${change.path}: diff too large omitted\n`);
    } else {
      appendDiff(text);
    }
    return;
  }

  if (stat?.isBinary) {
    structured.push(buildPlaceholderParsedDiffFile(change, { status: "binary", stat }));
    appendDiff(`# ${change.path}: binary diff omitted\n`);
    return;
  }

  if (truncated) {
    structured.push(buildPlaceholderParsedDiffFile(change, { status: "too_large", stat }));
    appendDiff(`# ${change.path}: diff too large omitted\n`);
    return;
  }

  appendDiff(text);
  const parsed = await parseAndHighlightDiff(text, cwd);
  const parsedFile =
    parsed[0] ??
    ({
      path: change.path,
      isNew: change.isNew,
      isDeleted: change.isDeleted,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      hunks: [],
    } satisfies ParsedDiffFile);

  structured.push({
    ...parsedFile,
    path: change.path,
    isNew: change.isNew,
    isDeleted: change.isDeleted,
    status: "ok",
  });
}

interface ProcessTrackedChangesInput {
  cwd: string;
  refsForDiff: CheckoutDiffRefs;
  trackedChanges: CheckoutFileChange[];
  ignoreWhitespace: boolean;
  appendDiff: (text: string) => void;
}

interface ProcessTrackedChangesResult {
  trackedChangeByPath: Map<string, CheckoutFileChange>;
  trackedNumstatByPath: Map<string, FileStat>;
  trackedPlaceholderByPath: Map<string, { status: "binary" | "too_large"; stat: FileStat }>;
  trackedDiffText: string;
}

async function processTrackedChanges(
  input: ProcessTrackedChangesInput,
): Promise<ProcessTrackedChangesResult> {
  const { cwd, refsForDiff, trackedChanges, ignoreWhitespace, appendDiff } = input;
  const trackedChangeByPath = new Map(trackedChanges.map((change) => [change.path, change]));
  const trackedNumstatByPath =
    trackedChanges.length > 0
      ? await getTrackedNumstatByPath(cwd, refsForDiff, ignoreWhitespace)
      : new Map<string, FileStat>();
  const trackedDiffPaths: string[] = [];
  const trackedPlaceholderByPath = new Map<
    string,
    { status: "binary" | "too_large"; stat: FileStat }
  >();

  for (const change of trackedChanges) {
    const stat = trackedNumstatByPath.get(change.path) ?? null;
    if (stat?.isBinary) {
      trackedPlaceholderByPath.set(change.path, { status: "binary", stat });
      continue;
    }
    trackedDiffPaths.push(change.path);
  }

  let trackedDiffText = "";
  let trackedDiffBytes = 0;
  if (trackedDiffPaths.length > 0) {
    const trackedDiffs = await Promise.all(
      trackedDiffPaths.map((path) =>
        getTrackedDiffTextForPath({
          cwd,
          refsForDiff,
          path,
          ignoreWhitespace,
        }),
      ),
    );

    const visibleTrackedDiffs: string[] = [];
    for (const fileDiff of trackedDiffs) {
      if (fileDiff.truncated) {
        trackedPlaceholderByPath.set(fileDiff.path, {
          status: "too_large",
          stat: trackedNumstatByPath.get(fileDiff.path) ?? null,
        });
        continue;
      }
      const diffBytes = Buffer.byteLength(fileDiff.text, "utf8");
      if (trackedDiffBytes + diffBytes > TOTAL_DIFF_MAX_BYTES) {
        trackedPlaceholderByPath.set(fileDiff.path, {
          status: "too_large",
          stat: trackedNumstatByPath.get(fileDiff.path) ?? null,
        });
        continue;
      }
      trackedDiffBytes += diffBytes;
      visibleTrackedDiffs.push(fileDiff.text);
    }

    trackedDiffText = visibleTrackedDiffs.join("");
    appendDiff(trackedDiffText);
  }

  return {
    trackedChangeByPath,
    trackedNumstatByPath,
    trackedPlaceholderByPath,
    trackedDiffText,
  };
}

async function resolveCheckoutDiffRefs(
  cwd: string,
  compare: CheckoutDiffCompare,
  context: CheckoutContext | undefined,
): Promise<CheckoutDiffRefs | null> {
  if (compare.mode === "uncommitted") {
    return { baseRef: "HEAD", includeUntracked: true };
  }
  const { storedBaseRef, resolvedBaseRef, baseSource } = await resolveBaseRefForCwd(cwd, context);
  const baseRef = compare.baseRef ?? resolvedBaseRef;
  if (!baseRef) {
    return null;
  }
  if (isExplicitBaseRefMismatch({ storedBaseRef, baseSource, requestedBaseRef: compare.baseRef })) {
    throw new Error(`Base ref mismatch: expected ${storedBaseRef}, got ${compare.baseRef}`);
  }
  const bestBaseRef = await resolveBestComparisonBaseRef(cwd, baseRef, context);
  return {
    baseRef: (await tryResolveMergeBase(cwd, bestBaseRef)) ?? bestBaseRef,
    targetRef: "HEAD",
    includeUntracked: false,
  };
}

export async function getCheckoutDiff(
  cwd: string,
  compare: CheckoutDiffCompare,
  context?: CheckoutContext,
): Promise<CheckoutDiffResult> {
  await requireGitRepo(cwd);

  const refsForDiff = await resolveCheckoutDiffRefs(cwd, compare, context);
  if (!refsForDiff) {
    return { diff: "" };
  }

  const ignoreWhitespace = compare.ignoreWhitespace === true;
  let effectiveRefsForDiff = refsForDiff;
  let changes: CheckoutFileChange[];
  try {
    changes = await listCheckoutFileChanges(cwd, effectiveRefsForDiff, ignoreWhitespace);
  } catch (error) {
    if (!isUnbornHeadDiffError(error)) {
      throw error;
    }
    effectiveRefsForDiff = { ...refsForDiff, baseRef: EMPTY_TREE_OBJECT_ID };
    changes = await listCheckoutFileChanges(cwd, effectiveRefsForDiff, ignoreWhitespace);
  }
  changes.sort((a, b) => {
    if (a.path === b.path) return 0;
    return a.path < b.path ? -1 : 1;
  });

  const structured: ParsedDiffFile[] = [];
  let diffText = "";
  let diffBytes = 0;
  const appendDiff = (text: string) => {
    if (!text) return;
    if (diffBytes >= TOTAL_DIFF_MAX_BYTES) return;
    const buf = Buffer.from(text, "utf8");
    if (diffBytes + buf.length <= TOTAL_DIFF_MAX_BYTES) {
      diffText += text;
      diffBytes += buf.length;
      return;
    }
    const remaining = TOTAL_DIFF_MAX_BYTES - diffBytes;
    if (remaining > 0) {
      diffText += buf.subarray(0, remaining).toString("utf8");
      diffBytes = TOTAL_DIFF_MAX_BYTES;
    }
  };

  const trackedChanges = changes.filter((change) => !change.isUntracked);
  const untrackedChanges = changes.filter((change) => change.isUntracked === true);
  const trackedDiff = await processTrackedChanges({
    cwd,
    refsForDiff: effectiveRefsForDiff,
    trackedChanges,
    ignoreWhitespace,
    appendDiff,
  });

  const appendTrackedPlaceholderComment = (
    change: CheckoutFileChange,
    status: "binary" | "too_large",
  ) => {
    if (status === "binary") {
      appendDiff(`# ${change.path}: binary diff omitted\n`);
      return;
    }
    appendDiff(`# ${change.path}: diff too large omitted\n`);
  };

  if (compare.includeStructured) {
    await appendStructuredTrackedDiffs({
      cwd,
      trackedChanges,
      trackedChangeByPath: trackedDiff.trackedChangeByPath,
      trackedNumstatByPath: trackedDiff.trackedNumstatByPath,
      trackedPlaceholderByPath: trackedDiff.trackedPlaceholderByPath,
      trackedDiffText: trackedDiff.trackedDiffText,
      refsForDiff: effectiveRefsForDiff,
      ignoreWhitespace,
      structured,
      appendDiff,
      appendTrackedPlaceholderComment,
    });
  } else {
    for (const change of trackedChanges) {
      const placeholder = trackedDiff.trackedPlaceholderByPath.get(change.path);
      if (placeholder) {
        appendTrackedPlaceholderComment(change, placeholder.status);
      }
    }
  }

  for (const change of untrackedChanges) {
    if (diffBytes >= TOTAL_DIFF_MAX_BYTES) {
      break;
    }
    await processUntrackedChange({
      cwd,
      change,
      ignoreWhitespace,
      includeStructured: compare.includeStructured === true,
      structured,
      appendDiff,
    });
  }

  if (compare.includeStructured) {
    return { diff: diffText, structured };
  }
  return { diff: diffText };
}

export async function commitChanges(
  cwd: string,
  options: { message: string; addAll?: boolean },
): Promise<void> {
  await requireGitRepo(cwd);
  if (options.addAll ?? true) {
    await runGitCommand(["add", "-A"], { cwd, timeout: 120_000 });
  }
  await runGitCommand(["-c", "commit.gpgsign=false", "commit", "-m", options.message], {
    cwd,
    timeout: 120_000,
  });
}

export async function commitAll(cwd: string, message: string): Promise<void> {
  await commitChanges(cwd, { message, addAll: true });
}

const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
} as const;

const COMMIT_WRITE_TIMEOUT_MS = 120_000;
const COMMIT_HOOK_OUTPUT_MAX_BYTES = 64 * 1024;
const COMMIT_HOOK_FILES = ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit"];

export class InvalidCommitPathError extends Error {
  constructor(public readonly path: string) {
    super(`Commit path must be repo-relative: ${path}`);
    this.name = "InvalidCommitPathError";
  }
}

export interface CommitPathsInput {
  message: string;
  paths: string[];
}

/**
 * Outcome of a per-path commit. Mirrors the wire error union of
 * checkout.git.commit.response minus "agents_running", which is a session-level
 * guard, not a git outcome.
 */
export type CommitPathsResult =
  | { kind: "committed"; sha: string }
  | { kind: "identity_missing"; missingName: boolean; missingEmail: boolean }
  | { kind: "hook_failed"; output: string; exitCode: number | null }
  | { kind: "signing_failed"; detail: string }
  | { kind: "nothing_to_commit" }
  | { kind: "git_failed"; detail: string };

function assertRepoRelativeCommitPaths(paths: string[]): void {
  for (const path of paths) {
    const isAbsolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(path);
    const escapesRepo = path.split(/[\\/]/).includes("..");
    if (path.length === 0 || isAbsolute || escapesRepo) {
      throw new InvalidCommitPathError(path);
    }
  }
}

async function readCommitIdentityGaps(
  cwd: string,
): Promise<{ missingName: boolean; missingEmail: boolean }> {
  const readConfig = (key: string) =>
    runGitCommand(["config", "--get", key], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      acceptExitCodes: [0, 1],
    });
  const [name, email] = await Promise.all([readConfig("user.name"), readConfig("user.email")]);
  return {
    missingName: name.stdout.trim() === "",
    missingEmail: email.stdout.trim() === "",
  };
}

async function isCommitSigningEnabled(cwd: string): Promise<boolean> {
  const result = await runGitCommand(["config", "--type=bool", "--get", "commit.gpgsign"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 1],
  });
  return result.stdout.trim() === "true";
}

async function hasCommitHooks(cwd: string): Promise<boolean> {
  const revParse = await runGitCommand(["rev-parse", "--git-path", "hooks"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  const hooksDir = resolveGitRevParsePath(cwd, revParse.stdout);
  if (!hooksDir) {
    return false;
  }
  return COMMIT_HOOK_FILES.some((hook) => existsSync(resolve(hooksDir, hook)));
}

function combineCommitOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
}

const SIGNING_FAILURE_PATTERN =
  /gpg failed to sign|gpg: signing failed|cannot run gpg|no default signing key|failed to sign the data|ssh-keygen.*(?:failed|not found)/i;
const NOTHING_TO_COMMIT_PATTERN =
  /nothing to commit|no changes added to commit|nothing added to commit/i;

function classifyFailedCommit(input: {
  output: string;
  exitCode: number | null;
  signingEnabled: boolean;
  hooksPresent: boolean;
}): CommitPathsResult {
  const { output, exitCode, signingEnabled, hooksPresent } = input;
  if (NOTHING_TO_COMMIT_PATTERN.test(output)) {
    return { kind: "nothing_to_commit" };
  }
  if (/please tell me who you are/i.test(output)) {
    return { kind: "identity_missing", missingName: true, missingEmail: true };
  }
  if (signingEnabled && SIGNING_FAILURE_PATTERN.test(output)) {
    return { kind: "signing_failed", detail: output };
  }
  if (hooksPresent) {
    return { kind: "hook_failed", output, exitCode };
  }
  return { kind: "git_failed", detail: output };
}

/**
 * Stage the given repo-relative paths and commit exactly those paths — changes
 * already staged for other files stay staged and out of the commit. Never
 * prompts: terminal prompts are disabled, stdin is closed, and a hung signing
 * or hook process is killed at the timeout and reported as a structured
 * failure instead of hanging the daemon.
 */
export async function commitPaths(
  cwd: string,
  input: CommitPathsInput,
): Promise<CommitPathsResult> {
  await requireGitRepo(cwd);
  assertRepoRelativeCommitPaths(input.paths);
  if (input.paths.length === 0) {
    return { kind: "nothing_to_commit" };
  }

  const [identity, signingEnabled, hooksPresent] = await Promise.all([
    readCommitIdentityGaps(cwd),
    isCommitSigningEnabled(cwd),
    hasCommitHooks(cwd),
  ]);
  if (identity.missingName || identity.missingEmail) {
    return { kind: "identity_missing", ...identity };
  }

  await runGitCommand(["--literal-pathspecs", "add", "-A", "--", ...input.paths], {
    cwd,
    timeout: COMMIT_WRITE_TIMEOUT_MS,
    envOverlay: NON_INTERACTIVE_GIT_ENV,
  });

  let commit: GitCommandResult;
  try {
    commit = await runGitCommand(
      ["--literal-pathspecs", "commit", "-m", input.message, "--", ...input.paths],
      {
        cwd,
        timeout: COMMIT_WRITE_TIMEOUT_MS,
        envOverlay: NON_INTERACTIVE_GIT_ENV,
        acceptExitCodes: [0, 1, 128],
        maxStderrBytes: COMMIT_HOOK_OUTPUT_MAX_BYTES,
      },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const timedOut = /timed out/i.test(detail);
    if (timedOut && signingEnabled) {
      return {
        kind: "signing_failed",
        detail: `Commit signing did not complete within ${COMMIT_WRITE_TIMEOUT_MS / 1000}s — a signing prompt cannot be answered here. Commit from a terminal, or disable signing for this repository (git config commit.gpgsign false).`,
      };
    }
    if (timedOut && hooksPresent) {
      return { kind: "hook_failed", output: detail, exitCode: null };
    }
    return { kind: "git_failed", detail };
  }

  if (commit.exitCode !== 0) {
    return classifyFailedCommit({
      output: combineCommitOutput(commit.stdout, commit.stderr),
      exitCode: commit.exitCode,
      signingEnabled,
      hooksPresent,
    });
  }

  const head = await runGitCommand(["rev-parse", "HEAD"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  return { kind: "committed", sha: head.stdout.trim() };
}

export interface RollbackPathsInput {
  paths: string[];
}

/**
 * Outcome of a per-path rollback. Mirrors the wire error union of
 * checkout.git.rollback.response.
 */
export type RollbackPathsResult =
  | { kind: "rolled_back"; paths: string[] }
  | { kind: "nothing_to_rollback" }
  | { kind: "git_failed"; detail: string };

const ROLLBACK_WRITE_TIMEOUT_MS = 120_000;

/** True when HEAD has no commits yet (a fresh repo). */
async function isUnbornHead(cwd: string): Promise<boolean> {
  const result = await runGitCommand(["rev-parse", "--verify", "--quiet", "HEAD"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 1],
  });
  return result.exitCode !== 0;
}

/**
 * Repo-relative paths that exist in HEAD (tracked at the last commit). Paths not
 * in the returned set are "new" — added to the index and/or untracked — and are
 * discarded by removal rather than by restoring a HEAD version.
 */
async function listPathsInHead(cwd: string, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0 || (await isUnbornHead(cwd))) {
    return new Set();
  }
  const result = await runGitCommand(
    ["--literal-pathspecs", "ls-tree", "-z", "--name-only", "HEAD", "--", ...paths],
    { cwd, envOverlay: READ_ONLY_GIT_ENV },
  );
  return new Set(result.stdout.split("\0").filter((entry) => entry.length > 0));
}

/**
 * Discard uncommitted working-tree changes for the given repo-relative paths.
 * Tracked files (modified, deleted, or with staged changes) are reset to their
 * HEAD version in both the index and the working tree; files newly added since
 * HEAD (whether staged or untracked) are unstaged and removed from disk. Never
 * touches paths outside the given set.
 *
 * A working-tree rename shows up as its new path here: rolling it back deletes
 * the new path but does not resurrect the old one. That edge case aside, the
 * common modified / added / deleted cases are all handled.
 */
export async function rollbackPaths(
  cwd: string,
  input: RollbackPathsInput,
): Promise<RollbackPathsResult> {
  await requireGitRepo(cwd);
  assertRepoRelativeCommitPaths(input.paths);
  if (input.paths.length === 0) {
    return { kind: "nothing_to_rollback" };
  }

  try {
    const inHead = await listPathsInHead(cwd, input.paths);
    const existingPaths = input.paths.filter((path) => inHead.has(path));
    const newPaths = input.paths.filter((path) => !inHead.has(path));

    if (existingPaths.length > 0) {
      // `checkout HEAD -- <paths>` resets the index and working tree for tracked
      // paths, discarding both staged and unstaged edits and restoring deletions.
      await runGitCommand(["--literal-pathspecs", "checkout", "HEAD", "--", ...existingPaths], {
        cwd,
        timeout: ROLLBACK_WRITE_TIMEOUT_MS,
        envOverlay: NON_INTERACTIVE_GIT_ENV,
      });
    }

    if (newPaths.length > 0) {
      // Unstage any staged additions (ignore-unmatch keeps purely-untracked paths
      // from erroring), then delete the untracked working-tree files.
      await runGitCommand(
        [
          "--literal-pathspecs",
          "rm",
          "-f",
          "--quiet",
          "--cached",
          "--ignore-unmatch",
          "--",
          ...newPaths,
        ],
        { cwd, timeout: ROLLBACK_WRITE_TIMEOUT_MS, envOverlay: NON_INTERACTIVE_GIT_ENV },
      );
      await runGitCommand(["--literal-pathspecs", "clean", "-fdq", "--", ...newPaths], {
        cwd,
        timeout: ROLLBACK_WRITE_TIMEOUT_MS,
        envOverlay: NON_INTERACTIVE_GIT_ENV,
      });
    }

    return { kind: "rolled_back", paths: input.paths };
  } catch (error) {
    return { kind: "git_failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

interface DetectMergeToBaseConflictInput {
  operationCwd: string;
  error: unknown;
  baseRef: string;
  currentBranch: string;
}

async function detectAndThrowMergeToBaseConflict(
  input: DetectMergeToBaseConflictInput,
): Promise<void> {
  const { operationCwd, error, baseRef, currentBranch } = input;
  const errorDetails =
    error instanceof Error
      ? `${error.message}\n${getErrorStderr(error)}\n${getErrorStdout(error)}`
      : String(error);
  try {
    const [unmergedOutput, lsFilesOutput, statusOutput] = await Promise.all([
      runGitCommand(["diff", "--name-only", "--diff-filter=U"], { cwd: operationCwd }),
      runGitCommand(["ls-files", "-u"], { cwd: operationCwd }),
      runGitCommand(["status", "--porcelain"], { cwd: operationCwd }),
    ]);
    const statusConflicts = statusOutput.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /^(UU|AA|DD|AU|UA|UD|DU)\s/.test(line))
      .map((line) => line.slice(3).trim());
    const conflicts = [
      ...unmergedOutput.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      ...lsFilesOutput.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split("\t").at(-1) ?? ""),
      ...statusConflicts,
    ].filter(Boolean);
    const conflictDetected =
      conflicts.length > 0 || /CONFLICT|Automatic merge failed/i.test(errorDetails);
    if (conflictDetected) {
      try {
        await runGitCommand(["merge", "--abort"], { cwd: operationCwd, timeout: 120_000 });
      } catch {
        // ignore
      }
      throw new MergeConflictError({
        baseRef,
        currentBranch,
        conflictFiles: conflicts.length > 0 ? conflicts : [],
      });
    }
  } catch (innerError) {
    if (innerError instanceof MergeConflictError) {
      throw innerError;
    }
    // ignore detection failures
  }
}

export async function mergeToBase(
  cwd: string,
  options: MergeToBaseOptions = {},
  context?: CheckoutContext,
): Promise<string> {
  await requireGitRepo(cwd);
  const currentBranch = await getCurrentBranch(cwd);
  const { storedBaseRef, resolvedBaseRef, baseSource } = await resolveBaseRefForCwd(cwd, context);
  const baseRef = options.baseRef ?? resolvedBaseRef;
  if (!baseRef) {
    throw new Error("Unable to determine base branch for merge");
  }
  if (isExplicitBaseRefMismatch({ storedBaseRef, baseSource, requestedBaseRef: options.baseRef })) {
    throw new Error(`Base ref mismatch: expected ${storedBaseRef}, got ${options.baseRef}`);
  }
  if (!currentBranch) {
    throw new Error("Unable to determine current branch for merge");
  }
  let normalizedBaseRef = baseRef;
  normalizedBaseRef = normalizeLocalBranchRefName(normalizedBaseRef);
  const currentWorktreeRoot = (await getWorktreeRoot(cwd)) ?? cwd;
  if (normalizedBaseRef === currentBranch) {
    return currentWorktreeRoot;
  }

  const baseWorktree = await getWorktreePathForBranch(cwd, normalizedBaseRef);
  const operationCwd = baseWorktree ?? currentWorktreeRoot;
  const isSameCheckout = resolve(operationCwd) === resolve(currentWorktreeRoot);
  const originalBranch = await getCurrentBranch(operationCwd);
  const mode = options.mode ?? "merge";
  try {
    await runGitCommand(["checkout", normalizedBaseRef], {
      cwd: operationCwd,
      timeout: 120_000,
    });
    if (mode === "squash") {
      await runGitCommand(["merge", "--squash", currentBranch], {
        cwd: operationCwd,
        timeout: 120_000,
      });
      const message =
        options.commitMessage ?? `Squash merge ${currentBranch} into ${normalizedBaseRef}`;
      await runGitCommand(["-c", "commit.gpgsign=false", "commit", "-m", message], {
        cwd: operationCwd,
        timeout: 120_000,
      });
    } else {
      await runGitCommand(["merge", currentBranch], { cwd: operationCwd, timeout: 120_000 });
    }
  } catch (error) {
    await detectAndThrowMergeToBaseConflict({
      operationCwd,
      error,
      baseRef: normalizedBaseRef,
      currentBranch,
    });
    throw error;
  } finally {
    if (isSameCheckout && originalBranch && originalBranch !== normalizedBaseRef) {
      try {
        await runGitCommand(["checkout", originalBranch], {
          cwd: operationCwd,
          timeout: 120_000,
        });
      } catch {
        // ignore
      }
    }
  }
  return operationCwd;
}

export async function mergeFromBase(
  cwd: string,
  options: MergeFromBaseOptions = {},
  context?: CheckoutContext,
): Promise<void> {
  await requireGitRepo(cwd);
  const currentBranch = await getCurrentBranch(cwd);
  if (!currentBranch || currentBranch === "HEAD") {
    throw new Error("Unable to determine current branch for merge");
  }

  const { storedBaseRef, resolvedBaseRef, baseSource } = await resolveBaseRefForCwd(cwd, context);
  const baseRef = options.baseRef ?? resolvedBaseRef;
  if (!baseRef) {
    throw new Error("Unable to determine base branch for merge");
  }
  if (isExplicitBaseRefMismatch({ storedBaseRef, baseSource, requestedBaseRef: options.baseRef })) {
    throw new Error(`Base ref mismatch: expected ${storedBaseRef}, got ${options.baseRef}`);
  }

  const requireCleanTarget = options.requireCleanTarget ?? true;
  if (requireCleanTarget) {
    const { stdout } = await runGitCommand(["status", "--porcelain"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    if (stdout.trim().length > 0) {
      throw new Error("Working directory has uncommitted changes.");
    }
  }

  const normalizedBaseRef = normalizeLocalBranchRefName(baseRef);
  const bestBaseRef = await resolveMostAheadBaseRef(cwd, normalizedBaseRef);
  if (bestBaseRef === currentBranch) {
    return;
  }

  try {
    await runGitCommand(["merge", bestBaseRef], { cwd, timeout: 120_000 });
  } catch (error) {
    await detectAndThrowMergeFromBaseConflict({
      cwd,
      error,
      baseRef: bestBaseRef,
      currentBranch,
    });
    throw error;
  }
}

interface DetectMergeFromBaseConflictInput {
  cwd: string;
  error: unknown;
  baseRef: string;
  currentBranch: string;
}

async function detectAndThrowMergeFromBaseConflict(
  input: DetectMergeFromBaseConflictInput,
): Promise<void> {
  const { cwd, error, baseRef, currentBranch } = input;
  const errorDetails =
    error instanceof Error
      ? `${error.message}\n${getErrorStderr(error)}\n${getErrorStdout(error)}`
      : String(error);
  try {
    const [unmergedOutput, lsFilesOutput, statusOutput] = await Promise.all([
      runGitCommand(["diff", "--name-only", "--diff-filter=U"], { cwd }),
      runGitCommand(["ls-files", "-u"], { cwd }),
      runGitCommand(["status", "--porcelain"], { cwd }),
    ]);
    const statusConflicts = statusOutput.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /^(UU|AA|DD|AU|UA|UD|DU)\s/.test(line))
      .map((line) => line.slice(3).trim());
    const conflicts = [
      ...unmergedOutput.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      ...lsFilesOutput.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split("\t").at(-1) ?? ""),
      ...statusConflicts,
    ].filter(Boolean);
    const conflictDetected =
      conflicts.length > 0 || /CONFLICT|Automatic merge failed/i.test(errorDetails);
    if (conflictDetected) {
      try {
        await runGitCommand(["merge", "--abort"], { cwd, timeout: 120_000 });
      } catch {
        // ignore
      }
      throw new MergeFromBaseConflictError({
        baseRef,
        currentBranch,
        conflictFiles: conflicts.length > 0 ? conflicts : [],
      });
    }
  } catch (innerError) {
    if (innerError instanceof MergeFromBaseConflictError) {
      throw innerError;
    }
    // ignore detection failures
  }
}

export async function pullCurrentBranch(cwd: string, github?: ForgeService): Promise<void> {
  await requireGitRepo(cwd);
  const currentBranch = await getCurrentBranch(cwd);
  if (!currentBranch || currentBranch === "HEAD") {
    throw new Error("Unable to determine current branch for pull");
  }
  const hasRemote = await hasOriginRemote(cwd);
  if (!hasRemote) {
    throw new Error("Remote 'origin' is not configured.");
  }
  try {
    await runGitCommand(["pull"], { cwd, timeout: 120_000 });
    github?.invalidate({ cwd });
  } catch (error) {
    await abortGitPullConflictState(cwd);
    throw error;
  }
}

export async function pushCurrentBranch(cwd: string, github?: ForgeService): Promise<void> {
  await requireGitRepo(cwd);
  const currentBranch = await getCurrentBranch(cwd);
  if (!currentBranch || currentBranch === "HEAD") {
    throw new Error("Unable to determine current branch for push");
  }
  const configuredPushTarget = await getCurrentBranchConfiguredPushTarget(cwd, currentBranch);
  if (configuredPushTarget) {
    await runGitCommand(
      ["push", configuredPushTarget.remoteName, `HEAD:refs/heads/${configuredPushTarget.headRef}`],
      { cwd, timeout: 120_000 },
    );
    await refreshCurrentBranchTrackedRefAfterPush(cwd, currentBranch, configuredPushTarget);
    github?.invalidate({ cwd });
    return;
  }

  const upstreamTarget = await getCurrentBranchUpstreamPushTarget(cwd, currentBranch);
  if (upstreamTarget) {
    await runGitCommand(
      ["push", "-u", upstreamTarget.remoteName, `HEAD:refs/heads/${upstreamTarget.headRef}`],
      { cwd, timeout: 120_000 },
    );
    github?.invalidate({ cwd });
    return;
  }

  const hasRemote = await hasOriginRemote(cwd);
  if (!hasRemote) {
    throw new Error("Remote 'origin' is not configured.");
  }
  await runGitCommand(["push", "-u", "origin", currentBranch], { cwd, timeout: 120_000 });
  github?.invalidate({ cwd });
}

async function getCurrentBranchConfiguredPushTarget(
  cwd: string,
  currentBranch: string,
): Promise<{ remoteName: string; headRef: string } | null> {
  const remoteName = await getGitConfigValue(cwd, `branch.${currentBranch}.pushRemote`);
  const pushRefspec = remoteName ? await getGitConfigValue(cwd, `remote.${remoteName}.push`) : null;
  const headRef = parseHeadPushRefspec(pushRefspec);
  if (!remoteName || !headRef) {
    return null;
  }
  const remoteUrl = await getGitConfigValue(cwd, `remote.${remoteName}.url`);
  return remoteUrl ? { remoteName, headRef } : null;
}

async function refreshCurrentBranchTrackedRefAfterPush(
  cwd: string,
  currentBranch: string,
  pushedTarget: { remoteName: string; headRef: string },
): Promise<void> {
  const trackingRemoteName = await getGitConfigValue(cwd, `branch.${currentBranch}.remote`);
  const trackingMergeRef = await getGitConfigValue(cwd, `branch.${currentBranch}.merge`);
  const trackingHeadRef = parseBranchMergeHeadRef(trackingMergeRef);
  if (!trackingRemoteName && !trackingMergeRef) {
    const updated = await updateRemoteTrackingRef(
      cwd,
      pushedTarget.remoteName,
      pushedTarget.headRef,
    );
    if (!updated) {
      return;
    }
    await runGitCommand(["config", `branch.${currentBranch}.remote`, pushedTarget.remoteName], {
      cwd,
    });
    await runGitCommand(
      ["config", `branch.${currentBranch}.merge`, `refs/heads/${pushedTarget.headRef}`],
      {
        cwd,
      },
    );
    return;
  }
  if (!trackingRemoteName || trackingHeadRef !== pushedTarget.headRef) {
    return;
  }

  const [trackingRemotePushUrl, pushedRemotePushUrl] = await Promise.all([
    getGitRemotePushUrl(cwd, trackingRemoteName),
    getGitRemotePushUrl(cwd, pushedTarget.remoteName),
  ]);
  if (!trackingRemotePushUrl || trackingRemotePushUrl !== pushedRemotePushUrl) {
    return;
  }

  await updateRemoteTrackingRef(cwd, trackingRemoteName, trackingHeadRef);
}

async function updateRemoteTrackingRef(
  cwd: string,
  remoteName: string,
  headRef: string,
): Promise<boolean> {
  const trackingRef = `refs/remotes/${remoteName}/${headRef}`;
  const checkRef = await runGitCommand(["check-ref-format", trackingRef], {
    cwd,
    acceptExitCodes: [0, 1],
  });
  if (checkRef.exitCode !== 0) {
    return false;
  }
  await runGitCommand(["update-ref", trackingRef, "HEAD"], { cwd, timeout: 120_000 });
  return true;
}

async function getCurrentBranchUpstreamPushTarget(
  cwd: string,
  currentBranch: string,
): Promise<{ remoteName: string; headRef: string } | null> {
  const remoteName = await getGitConfigValue(cwd, `branch.${currentBranch}.remote`);
  const mergeRef = remoteName
    ? await getGitConfigValue(cwd, `branch.${currentBranch}.merge`)
    : null;
  const headRef = parseBranchMergeHeadRef(mergeRef);
  if (!remoteName || !headRef) {
    return null;
  }
  const remoteUrl = await getGitConfigValue(cwd, `remote.${remoteName}.url`);
  return remoteUrl ? { remoteName, headRef } : null;
}

function parseHeadPushRefspec(refspec: string | null): string | null {
  const prefix = "HEAD:refs/heads/";
  const normalized = refspec?.trim().replace(/^\+/, "");
  if (!normalized?.startsWith(prefix)) {
    return null;
  }
  const headRef = normalized.slice(prefix.length).trim();
  return headRef.length > 0 ? headRef : null;
}

export interface CreatePullRequestOptions {
  title: string;
  body?: string;
  base?: string;
  head?: string;
  draft?: boolean;
}

export interface PullRequestStatus {
  number?: number;
  repoOwner?: string;
  repoName?: string;
  url: string;
  title: string;
  state: string;
  baseRefName: string;
  headRefName: string;
  isMerged: boolean;
  isDraft?: boolean;
  mergeable?: PullRequestMergeable;
  checks?: PullRequestCheck[];
  checksStatus?: ChecksStatus;
  reviewDecision?: ReviewDecision;
  github?: GitHubPullRequestStatusFacts;
}

export interface PullRequestStatusResult {
  status: PullRequestStatus | null;
  /** Why forge features are (un)available — drives the onboarding callout. */
  authState: ForgeAuthState;
  /** Kept in sync with {@link authState} for back-compat; true iff authenticated. */
  githubFeaturesEnabled: boolean;
}

function buildPullRequestStatusResult(
  status: PullRequestStatus | null,
  authState: ForgeAuthState,
): PullRequestStatusResult {
  return { status, authState, githubFeaturesEnabled: authState === "authenticated" };
}

/**
 * Map a forge CLI failure to an auth state. A missing-CLI error means the user
 * must install the tool; anything else surfaced as an auth probe failure means
 * they must sign in.
 */
export function forgeAuthStateFromError(error: unknown): ForgeAuthState {
  if (error instanceof GitHubCliMissingError) {
    return "cli_missing";
  }
  return "unauthenticated";
}

export interface PullRequestCheck {
  name: string;
  status: "success" | "failure" | "pending" | "skipped" | "cancelled";
  url: string | null;
  workflow?: string;
  duration?: string;
}

export type ChecksStatus = "none" | "pending" | "success" | "failure";

export type ReviewDecision = "approved" | "changes_requested" | "pending" | null;

export async function createPullRequest(
  cwd: string,
  options: CreatePullRequestOptions,
  forgeService: ForgeService = createGitHubService(),
  context?: CheckoutContext,
): Promise<{ url: string; number: number }> {
  await requireGitRepo(cwd);

  const head = options.head ?? (await getCurrentBranch(cwd));
  const { storedBaseRef, resolvedBaseRef } = await resolveBaseRefForCwd(cwd, context);
  const base = options.base ?? resolvedBaseRef;
  if (!head) {
    throw new Error("Unable to determine head branch for PR");
  }
  if (!base) {
    throw new Error("Unable to determine base branch for PR");
  }
  const normalizedBase = normalizeLocalBranchRefName(base);
  if (storedBaseRef && options.base && options.base !== storedBaseRef) {
    throw new Error(`Base ref mismatch: expected ${base}, got ${options.base}`);
  }

  // The push deliberately happens before the adapter resolves the target
  // repository: slug resolution is adapter-internal (e.g. `gh repo view`, which
  // handles GHES and renamed repos), and the RPC path only reaches here after
  // the forge resolver has already matched the origin remote to a forge. If the
  // adapter still fails after the push, retrying is safe — the non-force push
  // of the head branch is idempotent.
  await runGitCommand(["push", "-u", "origin", head], { cwd, timeout: 120_000 });

  const result = await forgeService.createPullRequest({
    cwd,
    title: options.title,
    body: options.body,
    head,
    base: normalizedBase,
  });
  forgeService.invalidate({ cwd });
  return result;
}

export async function getPullRequestStatus(
  cwd: string,
  forgeService: ForgeService = createGitHubService(),
  options?: CheckoutReadCacheOptions,
  context?: CheckoutContext,
): Promise<PullRequestStatusResult> {
  const cacheKey = getPullRequestStatusCacheKey(cwd);
  if (!options?.force) {
    const cached = pullRequestStatusCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const existing = pullRequestStatusInFlight.get(cacheKey);
    if (existing) {
      return existing;
    }
  }

  const lookup = getPullRequestStatusUncached(cwd, forgeService, options, context)
    .then((status) => {
      pullRequestStatusCache.set(cacheKey, status);
      rememberPullRequestStatus(cacheKey, status);
      return status;
    })
    .catch((error) => {
      if (!options?.force && error instanceof GitHubCommandError) {
        const stale = lastSuccessfulPullRequestStatus.get(cacheKey);
        if (stale) {
          return stale;
        }
      }
      throw error;
    })
    .finally(() => {
      pullRequestStatusInFlight.delete(cacheKey);
    });

  pullRequestStatusInFlight.set(cacheKey, lookup);
  return lookup;
}

async function getPullRequestStatusUncached(
  cwd: string,
  forgeService: ForgeService,
  options?: CheckoutReadCacheOptions,
  context?: CheckoutContext,
): Promise<PullRequestStatusResult> {
  if (context?.facts?.isGit === false) {
    return {
      status: null,
      authState: "no_remote",
      githubFeaturesEnabled: false,
    };
  }
  if (!context?.facts?.isGit) {
    await requireGitRepo(cwd);
  }
  const head = context?.facts?.isGit ? context.facts.currentBranch : await getCurrentBranch(cwd);
  if (!head) {
    return {
      status: null,
      authState: "no_remote",
      githubFeaturesEnabled: false,
    };
  }
  try {
    const lookupTarget = await resolvePullRequestStatusLookupTarget(cwd, head, context);
    let status: CurrentPullRequestStatus | null;
    if (options?.force) {
      const reason = options.reason;
      if (!reason) {
        throw new Error("Forced PR status read requires a reason");
      }
      status = await forgeService.getCurrentPullRequestStatus({
        cwd,
        ...lookupTarget,
        force: true,
        reason,
      });
    } else {
      status = await forgeService.getCurrentPullRequestStatus({
        cwd,
        ...lookupTarget,
        reason: options?.reason,
      });
    }
    return buildPullRequestStatusResult(status, "authenticated");
  } catch (error) {
    if (
      error instanceof GitHubCliMissingError ||
      error instanceof GitHubAuthenticationError ||
      isGitHostingFeatureDisabledError(error)
    ) {
      return buildPullRequestStatusResult(null, forgeAuthStateFromError(error));
    }
    throw error;
  }
}

export async function listCheckoutCommits({
  cwd,
  context,
}: {
  cwd: string;
  context?: CheckoutContext;
}): Promise<CheckoutCommitsResult> {
  const currentBranch = await getCurrentBranch(cwd);
  if (!currentBranch) {
    return { baseRef: null, commits: [] };
  }

  const { resolvedBaseRef } = await resolveBaseRefForCwd(cwd, context);
  const normalizedBaseRef = resolvedBaseRef ? normalizeLocalBranchRefName(resolvedBaseRef) : null;
  let comparisonBaseRef = await tryResolveCheckoutCommitsBaseRef(
    cwd,
    resolvedBaseRef,
    currentBranch,
  );
  if (!comparisonBaseRef && normalizedBaseRef && normalizedBaseRef !== currentBranch) {
    // Saved worktree metadata can outlive a renamed or deleted base branch.
    comparisonBaseRef = await tryResolveCheckoutCommitsBaseRef(
      cwd,
      await resolveBaseRef(cwd),
      currentBranch,
    );
  }

  let workspaceRecords: ParsedCheckoutCommit[] = [];
  let baseRevision = "HEAD";
  if (comparisonBaseRef) {
    const [records, mergeBase] = await Promise.all([
      getCheckoutCommitRecords({ cwd, revision: `${comparisonBaseRef}..HEAD` }),
      tryResolveMergeBase(cwd, comparisonBaseRef),
    ]);
    workspaceRecords = records;
    baseRevision = mergeBase ?? "";
  }

  const baseRecords = baseRevision
    ? await getCheckoutCommitRecords({
        cwd,
        revision: baseRevision,
        maxCount: CHECKOUT_BASE_COMMIT_LIMIT,
      })
    : [];
  const records = [...workspaceRecords, ...baseRecords];
  if (records.length === 0) {
    return { baseRef: comparisonBaseRef, commits: [] };
  }

  const unpushedShas = await getUnpushedCommitShas(cwd);
  const workspaceShas = new Set(workspaceRecords.map((record) => record.sha));

  const commits = records.map((record) => ({
    sha: record.sha,
    shortSha: record.shortSha,
    subject: record.subject,
    authorName: record.authorName,
    authorDate: record.authorDate,
    isOnRemote: !unpushedShas.has(record.sha),
    isOnBase: !workspaceShas.has(record.sha),
    files: record.files,
  }));

  return { baseRef: comparisonBaseRef, commits };
}

/**
 * Fetches the unified diff of a single file as introduced by one commit and
 * parses it into the same {@link ParsedDiffFile} shape the diff subscription
 * emits (so the client can reuse its existing renderer).
 *
 * Compares merge commits to their first parent, matching the linear history shown
 * in the explorer. The text is parsed and highlighted by
 * {@link parseAndHighlightDiff} — the exact parser the diff subscription uses.
 * Returns `null` when the file is absent from the commit or the change is
 * binary-only (no textual hunks). Throws on git failure (e.g. an unknown sha),
 * which the caller maps to a typed checkout error.
 */
export async function getCommitFileDiff({
  cwd,
  sha,
  path,
}: {
  cwd: string;
  sha: string;
  path: string;
}): Promise<ParsedDiffFile | null> {
  const { stdout } = await runGitCommand(
    ["show", sha, "--format=", "--diff-merges=first-parent", "--", path],
    {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    },
  );

  if (stdout.trim().length === 0) {
    return null;
  }

  const parsedFiles = await parseAndHighlightDiff(stdout, cwd, {
    getOldFileContent: (file) => readGitFileContentAtRef(cwd, `${sha}^`, file.path),
    getNewFileContent: (file) => readGitFileContentAtRef(cwd, sha, file.path),
  });

  // `--` scopes the diff to a single pathspec, so there is at most one real
  // entry. Pick by path to drop any stray header-only section the parser emits.
  const file = parsedFiles.find((candidate) => candidate.path === path) ?? null;
  if (!file) {
    return null;
  }

  // Binary changes carry a "Binary files ... differ" marker and no hunks; there
  // is nothing textual to render, so report them as absent.
  if (file.hunks.length === 0 && /^Binary files .* differ$/m.test(stdout)) {
    return null;
  }

  return file;
}

async function getCheckoutCommitRecords({
  cwd,
  revision,
  maxCount,
}: CheckoutCommitLogInput): Promise<ParsedCheckoutCommit[]> {
  const args = [
    "log",
    revision,
    "--diff-merges=first-parent",
    `--format=${COMMIT_LOG_FORMAT}`,
    "--raw",
    "--numstat",
    "-M",
  ];
  if (maxCount !== undefined) {
    args.splice(2, 0, `--max-count=${maxCount}`);
  }

  const result = await runGitCommand(args, { cwd, envOverlay: READ_ONLY_GIT_ENV });
  if (result.truncated) {
    throw new Error("Commit history exceeded the git output limit");
  }
  return parseCheckoutCommitRecords(result.stdout);
}

async function tryResolveCheckoutCommitsBaseRef(
  cwd: string,
  baseRef: string | null,
  currentBranch: string,
): Promise<string | null> {
  if (!baseRef) {
    return null;
  }
  const normalizedBaseRef = normalizeLocalBranchRefName(baseRef);
  if (!normalizedBaseRef || normalizedBaseRef === currentBranch) {
    return null;
  }
  return resolveMostAheadBaseRef(cwd, normalizedBaseRef).catch(() => null);
}

// Returns commits reachable from HEAD that are not reachable from any remote ref.
async function getUnpushedCommitShas(cwd: string, context?: CheckoutContext): Promise<Set<string>> {
  const { stdout } = await runGitCommand(["rev-list", "HEAD", "--not", "--remotes"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    logger: context?.logger,
  });
  return new Set(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

export interface CheckoutCommitsResult {
  baseRef: string | null;
  commits: CheckoutCommit[];
}

interface ParsedCheckoutCommit {
  sha: string;
  shortSha: string;
  authorName: string;
  authorDate: string;
  subject: string;
  files: CheckoutCommitFile[];
}

// Workspace history stays complete; base history is bounded context until the
// commits list supports paging older base commits.
const CHECKOUT_BASE_COMMIT_LIMIT = 10;

interface CheckoutCommitLogInput {
  cwd: string;
  revision: string;
  maxCount?: number;
}

// Record-separated, NUL-field-separated so arbitrary subject text stays parseable.
// `%x1e`/`%x00` are git placeholders (literal text in the arg, real bytes in the
// output) — passing actual NUL bytes as a process arg is rejected by Node.
const COMMIT_LOG_FORMAT = "%x1e%H%x00%h%x00%an%x00%aI%x00%s";

// Parses the single combined `git log ... --raw --numstat -M` stream. Each record
// (split on the record separator) starts with the NUL-field-separated header line,
// then a blank line, then the interleaved `--raw` (status) and `--numstat` (counts)
// blocks. We merge both by destination path so each file carries counts + status.
function parseCheckoutCommitRecords(stdout: string): ParsedCheckoutCommit[] {
  const records = stdout.split(COMMIT_RECORD_SEPARATOR).filter((record) => record.length > 0);
  const commits: ParsedCheckoutCommit[] = [];
  for (const record of records) {
    const lines = record.split("\n");
    const fields = (lines[0] ?? "").split(COMMIT_FIELD_SEPARATOR);
    if (fields.length < 5) {
      continue;
    }
    const sha = (fields[0] ?? "").trim();
    if (!sha) {
      continue;
    }

    const stats = new Map<string, { additions: number; deletions: number }>();
    const statuses = new Map<string, CheckoutCommitFileStatus>();
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (!line) {
        continue;
      }
      if (line.startsWith(":")) {
        parseRawStatusLine(line, statuses);
      } else {
        parseNumstatLine(line, stats);
      }
    }

    const files: CheckoutCommitFile[] = [];
    for (const [path, stat] of stats) {
      const status = statuses.get(path);
      files.push({
        path,
        additions: stat.additions,
        deletions: stat.deletions,
        ...(status ? { status } : {}),
      });
    }

    commits.push({
      sha,
      shortSha: (fields[1] ?? "").trim(),
      authorName: fields[2] ?? "",
      authorDate: (fields[3] ?? "").trim(),
      subject: fields[4] ?? "",
      files,
    });
  }
  return commits;
}

const COMMIT_RECORD_SEPARATOR = "\x1e";

// Bytes git emits between fields/records. We split parsed output on these.
const COMMIT_FIELD_SEPARATOR = "\x00";

type CheckoutCommitFileStatus = NonNullable<CheckoutCommitFile["status"]>;

// A `--raw` line: `:<srcmode> <dstmode> <srcsha> <dstsha> <STATUS>\t<path>`
// (rename/copy add a second path: `R100\t<old>\t<new>`). The status token is the
// last space-separated field before the first tab. Keyed on the destination path.
function parseRawStatusLine(line: string, statuses: Map<string, CheckoutCommitFileStatus>): void {
  const tabParts = line.split("\t");
  const meta = tabParts[0] ?? "";
  const statusToken = meta.slice(meta.lastIndexOf(" ") + 1);
  const letter = statusToken.charAt(0);
  const status = mapNameStatusLetter(letter);
  if (!status) {
    return;
  }
  const path =
    letter === "R" || letter === "C" ? (tabParts[tabParts.length - 1] ?? "") : (tabParts[1] ?? "");
  if (!path) {
    return;
  }
  statuses.set(path, status);
}

// A `--numstat` line: `<adds>\t<dels>\t<path>` (renames use `old => new`, binary
// files report `-` for both counts). Keyed on the (normalized) destination path.
function parseNumstatLine(
  line: string,
  stats: Map<string, { additions: number; deletions: number }>,
): void {
  const parts = line.split("\t");
  if (parts.length < 3) {
    return;
  }
  const additionsField = parts[0] ?? "";
  const deletionsField = parts[1] ?? "";
  const path = normalizeNumstatPath(parts.slice(2).join("\t"));
  if (!path) {
    return;
  }
  if (additionsField === "-" || deletionsField === "-") {
    stats.set(path, { additions: 0, deletions: 0 });
    return;
  }
  const additions = Number.parseInt(additionsField, 10);
  const deletions = Number.parseInt(deletionsField, 10);
  if (Number.isNaN(additions) || Number.isNaN(deletions)) {
    return;
  }
  stats.set(path, { additions, deletions });
}

function mapNameStatusLetter(letter: string): CheckoutCommitFileStatus | undefined {
  switch (letter) {
    case "A":
      return "added";
    case "C":
      return "added";
    case "M":
      return "modified";
    case "T":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return undefined;
  }
}
