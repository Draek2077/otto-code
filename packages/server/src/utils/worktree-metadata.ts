import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { z } from "zod";

const ChangeRequestLookupTargetSchema = z.object({
  headRef: z.string().min(1),
  headRepositoryOwner: z.string().min(1).optional(),
  changeRequestNumber: z.number().int().positive().optional(),
  localBranchName: z.string().min(1).optional(),
});

// baseRefName is the display name; baseRef is the exact ref the worktree was cut from
// ("refs/remotes/upstream/main"). baseRef is optional because worktrees written before it
// existed only have the name — there are no migrations, so readers fall back.
const OttoWorktreeMetadataV1Schema = z.object({
  version: z.literal(1),
  baseRefName: z.string().min(1),
  baseRef: z.string().min(1).optional(),
  changeRequestLookupTarget: ChangeRequestLookupTargetSchema.optional(),
});

const OttoWorktreeMetadataV2Schema = z.object({
  version: z.literal(2),
  baseRefName: z.string().min(1),
  baseRef: z.string().min(1).optional(),
  changeRequestLookupTarget: ChangeRequestLookupTargetSchema.optional(),
  firstAgentBranchAutoName: z
    .discriminatedUnion("status", [
      z.object({
        status: z.literal("pending"),
        placeholderBranchName: z.string().min(1),
      }),
      z.object({
        status: z.literal("attempted"),
        placeholderBranchName: z.string().min(1),
        attemptedAt: z.string().min(1),
      }),
    ])
    .optional(),
  runtime: z
    .object({
      worktreePort: z.number().int().positive(),
    })
    .optional(),
});

const OttoWorktreeMetadataSchema = z.union([
  OttoWorktreeMetadataV1Schema,
  OttoWorktreeMetadataV2Schema,
]);

export type OttoWorktreeMetadata = z.infer<typeof OttoWorktreeMetadataSchema>;
export type OttoWorktreeChangeRequestHint = z.infer<typeof ChangeRequestLookupTargetSchema>;
export type OttoWorktreeChangeRequestLookupTarget = OttoWorktreeChangeRequestHint;

export function createOttoWorktreeChangeRequestHint(
  input: OttoWorktreeChangeRequestHint,
): OttoWorktreeChangeRequestHint {
  return ChangeRequestLookupTargetSchema.parse(input);
}

export function getOttoWorktreeChangeRequestHintForBranch(
  metadata: OttoWorktreeMetadata | null,
  currentBranch: string,
): OttoWorktreeChangeRequestHint | null {
  const target = metadata?.changeRequestLookupTarget;
  if (!target) {
    return null;
  }
  if (target.localBranchName) {
    return target.localBranchName === currentBranch ? target : null;
  }

  // COMPAT(change-request-local-branch): metadata before v0.2.5 omitted the
  // local binding; remove after 2027-07-31.
  const canonicalBranches = new Set<string>();
  if (target.headRepositoryOwner) {
    canonicalBranches.add(`${target.headRepositoryOwner}/${target.headRef}`);
    const normalizedOwner = normalizeLegacyGitHubOwnerForBranch(target.headRepositoryOwner);
    if (normalizedOwner) {
      canonicalBranches.add(`${normalizedOwner}/${target.headRef}`);
    }
  } else {
    canonicalBranches.add(target.headRef);
  }
  return canonicalBranches.has(currentBranch) ? target : null;
}

function normalizeLegacyGitHubOwnerForBranch(owner: string): string | null {
  const normalized = owner.trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(normalized) ? normalized : null;
}

export function rebindOttoWorktreeChangeRequestHint(
  worktreeRoot: string,
  previousBranch: string,
  currentBranch: string,
): boolean {
  const metadata = readOttoWorktreeMetadata(worktreeRoot);
  const target = getOttoWorktreeChangeRequestHintForBranch(metadata, previousBranch);
  if (!metadata || !target) {
    return false;
  }

  writeOttoWorktreeMetadataFile(worktreeRoot, {
    ...metadata,
    changeRequestLookupTarget: {
      ...target,
      localBranchName: currentBranch,
    },
  });
  return true;
}

function getGitDirForWorktreeRoot(worktreeRoot: string): string {
  const gitPath = join(worktreeRoot, ".git");
  if (!existsSync(gitPath)) {
    throw new Error(`Not a git repository: ${worktreeRoot}`);
  }

  // In a worktree checkout, `.git` is a file containing `gitdir: <path>`.
  // In a normal checkout, `.git` is a directory.
  try {
    const gitFileContent = readFileSync(gitPath, "utf8");
    const match = gitFileContent.match(/gitdir:\s*(.+)/);
    if (match?.[1]) {
      const raw = match[1].trim();
      return isAbsolute(raw) ? raw : resolve(worktreeRoot, raw);
    }
  } catch {
    // If `.git` is a directory, readFileSync will throw; fall through.
  }

  return gitPath;
}

export function getOttoWorktreeMetadataPath(worktreeRoot: string): string {
  const gitDir = getGitDirForWorktreeRoot(worktreeRoot);
  return join(gitDir, "otto", "worktree.json");
}

const REMOTE_TRACKING_PREFIX = "refs/remotes/";

/**
 * The human-readable branch name behind a ref. Display and legacy identity only — it cannot
 * round-trip, so anything that has to resolve to a commit keeps the exact ref instead.
 *
 * refs/remotes/<remote>/<branch> works for any remote, not just origin. Git allows slashes in
 * remote names, so refs/remotes/a/b/c is ambiguous and the first segment is read as the
 * remote: slashes are everywhere in branch names and rare in remote names. A remote genuinely
 * named "team/upstream" therefore displays as "upstream/main" rather than "main"; the exact
 * ref is unaffected, which is why this is display-only.
 */
export function branchNameFromRef(ref: string): string {
  const trimmed = ref.trim();
  if (trimmed.startsWith("refs/heads/")) {
    return trimmed.slice("refs/heads/".length);
  }
  if (trimmed.startsWith(REMOTE_TRACKING_PREFIX)) {
    const remainder = trimmed.slice(REMOTE_TRACKING_PREFIX.length);
    const separator = remainder.indexOf("/");
    return separator === -1 ? remainder : remainder.slice(separator + 1);
  }
  // Short form. It cannot be generalized to any remote the way the qualified form can:
  // without the remote list, "feature/x" is indistinguishable from "<remote>/x".
  if (trimmed.startsWith("origin/")) {
    return trimmed.slice("origin/".length);
  }
  return trimmed;
}

export function normalizeBaseRefName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Base branch is required");
  }
  return branchNameFromRef(trimmed);
}

function assertValidBaseRef(value: string): void {
  if (value === "HEAD") {
    throw new Error("Base branch cannot be HEAD");
  }
  if (value.includes("..") || value.includes("@{")) {
    throw new Error(`Invalid base branch: ${value}`);
  }
  if (!/^[0-9A-Za-z._/+-]+$/.test(value)) {
    throw new Error(`Invalid base branch: ${value}`);
  }
}

/** Normalizes and rejects anything git could read as a revision expression or a path escape. */
export function normalizeAndValidateBaseRefName(input: string): string {
  const baseRefName = normalizeBaseRefName(input);
  assertValidBaseRef(baseRefName);
  return baseRefName;
}

/**
 * Same safety checks as {@link normalizeAndValidateBaseRefName}, but **keeps** an `origin/`
 * qualifier instead of stripping it.
 *
 * `main` and `origin/main` are separate answers to "what is this diffed against?" - local can be
 * behind, ahead, or diverged from origin - so a base the user pinned explicitly has to survive
 * round-tripping. The comparison path honours the qualifier verbatim; merge and PR targets
 * collapse it back to the local name, because there is no such thing as opening a PR against a
 * remote-tracking ref.
 */
export function validateBaseRefNameAllowingRemote(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Base branch is required");
  }
  assertValidBaseRef(trimmed);
  return trimmed;
}

export function writeOttoWorktreeMetadata(
  worktreeRoot: string,
  options: {
    baseRefName: string;
    baseRef?: string;
    // Persisted, not dropped: this is how a change-request worktree remembers
    // which PR/MR it belongs to. The caller always passed it through a spread,
    // which slips past the excess-property check, so leaving it off this
    // signature discarded it silently for every checkout-change-request
    // worktree - and a cross-repo MR with no push remote has nothing else to
    // recover the lookup from.
    changeRequestLookupTarget?: OttoWorktreeChangeRequestLookupTarget;
  },
): void {
  const baseRefName = normalizeAndValidateBaseRefName(options.baseRefName);
  const baseRef = options.baseRef?.trim();
  if (baseRef) assertValidBaseRef(baseRef);

  const metadataPath = getOttoWorktreeMetadataPath(worktreeRoot);
  mkdirSync(join(getGitDirForWorktreeRoot(worktreeRoot), "otto"), { recursive: true });
  const metadata: OttoWorktreeMetadata = {
    version: 1,
    baseRefName,
    ...(baseRef ? { baseRef } : {}),
    ...(options.changeRequestLookupTarget
      ? { changeRequestLookupTarget: options.changeRequestLookupTarget }
      : {}),
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export function writeOttoWorktreeRuntimeMetadata(
  worktreeRoot: string,
  options: { worktreePort: number },
): void {
  if (!Number.isInteger(options.worktreePort) || options.worktreePort <= 0) {
    throw new Error(`Invalid worktree runtime port: ${options.worktreePort}`);
  }

  const current = readOttoWorktreeMetadata(worktreeRoot);
  if (!current) {
    throw new Error("Cannot persist worktree runtime metadata: missing base metadata");
  }

  const metadataPath = getOttoWorktreeMetadataPath(worktreeRoot);
  mkdirSync(join(getGitDirForWorktreeRoot(worktreeRoot), "otto"), { recursive: true });
  const next: OttoWorktreeMetadata = {
    ...current,
    version: 2,
    runtime: {
      worktreePort: options.worktreePort,
    },
  };
  writeFileSync(metadataPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function writeOttoWorktreeFirstAgentBranchAutoNameMetadata(
  worktreeRoot: string,
  options: { placeholderBranchName: string },
): void {
  const placeholderBranchName = options.placeholderBranchName.trim();
  if (!placeholderBranchName) {
    throw new Error("Placeholder branch name is required");
  }

  const current = readOttoWorktreeMetadata(worktreeRoot);
  if (!current) {
    throw new Error("Cannot persist first-agent branch auto-name metadata: missing base metadata");
  }

  writeOttoWorktreeMetadataFile(worktreeRoot, {
    ...current,
    version: 2,
    firstAgentBranchAutoName: {
      status: "pending",
      placeholderBranchName,
    },
  });
}

export function markOttoWorktreeFirstAgentBranchAutoNameAttempted(
  worktreeRoot: string,
  options: { attemptedAt?: string } = {},
): OttoWorktreeMetadata | null {
  const current = readOttoWorktreeMetadata(worktreeRoot);
  if (!current || current.version !== 2 || current.firstAgentBranchAutoName?.status !== "pending") {
    return current;
  }

  const next: OttoWorktreeMetadata = {
    ...current,
    version: 2,
    firstAgentBranchAutoName: {
      status: "attempted",
      placeholderBranchName: current.firstAgentBranchAutoName.placeholderBranchName,
      attemptedAt: options.attemptedAt ?? new Date().toISOString(),
    },
  };
  writeOttoWorktreeMetadataFile(worktreeRoot, next);
  return next;
}

/**
 * Repoints an existing worktree at a different base branch, keeping every other v2 field
 * (`writeOttoWorktreeMetadata` rewrites the file as a fresh v1 record and would drop them).
 * The base is a single source of truth: diff, ahead/behind, merge-into-base and PR creation
 * all read it, so a stacked branch retargeted at its parent stays consistent everywhere.
 */
export function setOttoWorktreeBaseRefName(worktreeRoot: string, baseRefName: string): string {
  const normalized = normalizeAndValidateBaseRefName(baseRefName);
  const current = readOttoWorktreeMetadata(worktreeRoot);
  if (!current) {
    throw new Error("Cannot change base branch: missing Otto worktree metadata");
  }

  writeOttoWorktreeMetadataFile(worktreeRoot, {
    version: 2,
    baseRefName: normalized,
    ...(current.version === 2 && current.firstAgentBranchAutoName
      ? { firstAgentBranchAutoName: current.firstAgentBranchAutoName }
      : {}),
    ...(current.version === 2 && current.runtime ? { runtime: current.runtime } : {}),
  });
  return normalized;
}

export function readOttoWorktreeMetadata(worktreeRoot: string): OttoWorktreeMetadata | null {
  const metadataPath = getOttoWorktreeMetadataPath(worktreeRoot);
  if (!existsSync(metadataPath)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(metadataPath, "utf8"));
  return OttoWorktreeMetadataSchema.parse(parsed);
}

export function requireOttoWorktreeBaseRefName(worktreeRoot: string): string {
  const metadataPath = getOttoWorktreeMetadataPath(worktreeRoot);
  const metadata = readOttoWorktreeMetadata(worktreeRoot);
  if (!metadata) {
    throw new Error(`Missing Otto worktree base metadata: ${metadataPath}`);
  }
  return metadata.baseRefName;
}

export function readOttoWorktreeRuntimePort(worktreeRoot: string): number | null {
  const metadata = readOttoWorktreeMetadata(worktreeRoot);
  if (!metadata) {
    return null;
  }
  if (metadata.version === 2 && metadata.runtime?.worktreePort) {
    return metadata.runtime.worktreePort;
  }
  return null;
}

function writeOttoWorktreeMetadataFile(worktreeRoot: string, metadata: OttoWorktreeMetadata): void {
  const metadataPath = getOttoWorktreeMetadataPath(worktreeRoot);
  mkdirSync(join(getGitDirForWorktreeRoot(worktreeRoot), "otto"), { recursive: true });
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}
