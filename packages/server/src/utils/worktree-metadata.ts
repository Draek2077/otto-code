import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { z } from "zod";

const ChangeRequestLookupTargetSchema = z.object({
  headRef: z.string().min(1),
  headRepositoryOwner: z.string().min(1).optional(),
  changeRequestNumber: z.number().int().positive().optional(),
});

const OttoWorktreeMetadataV1Schema = z.object({
  version: z.literal(1),
  baseRefName: z.string().min(1),
  changeRequestLookupTarget: ChangeRequestLookupTargetSchema.optional(),
});

const OttoWorktreeMetadataV2Schema = z.object({
  version: z.literal(2),
  baseRefName: z.string().min(1),
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

export type OttoWorktreeChangeRequestLookupTarget = z.infer<typeof ChangeRequestLookupTargetSchema>;

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

export function normalizeBaseRefName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Base branch is required");
  }
  if (trimmed.startsWith("origin/")) {
    return trimmed.slice("origin/".length);
  }
  return trimmed;
}

/** Rejects anything git could read as a revision expression or a path escape. */
function assertSafeBaseRefName(baseRefName: string): void {
  if (baseRefName === "HEAD") {
    throw new Error("Base branch cannot be HEAD");
  }
  if (baseRefName.includes("..") || baseRefName.includes("@{")) {
    throw new Error(`Invalid base branch: ${baseRefName}`);
  }
  if (!/^[0-9A-Za-z._/-]+$/.test(baseRefName)) {
    throw new Error(`Invalid base branch: ${baseRefName}`);
  }
}

/** Normalizes and rejects anything git could read as a revision expression or a path escape. */
export function normalizeAndValidateBaseRefName(input: string): string {
  const baseRefName = normalizeBaseRefName(input);
  assertSafeBaseRefName(baseRefName);
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
  assertSafeBaseRefName(trimmed);
  return trimmed;
}

export function writeOttoWorktreeMetadata(
  worktreeRoot: string,
  options: {
    baseRefName: string;
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

  const metadataPath = getOttoWorktreeMetadataPath(worktreeRoot);
  mkdirSync(join(getGitDirForWorktreeRoot(worktreeRoot), "otto"), { recursive: true });
  const metadata: OttoWorktreeMetadata = {
    version: 1,
    baseRefName,
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
    version: 2,
    baseRefName: current.baseRefName,
    ...(current.version === 2 && current.firstAgentBranchAutoName
      ? { firstAgentBranchAutoName: current.firstAgentBranchAutoName }
      : {}),
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
    version: 2,
    baseRefName: current.baseRefName,
    firstAgentBranchAutoName: {
      status: "pending",
      placeholderBranchName,
    },
    ...(current.version === 2 && current.runtime ? { runtime: current.runtime } : {}),
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
    version: 2,
    baseRefName: current.baseRefName,
    firstAgentBranchAutoName: {
      status: "attempted",
      placeholderBranchName: current.firstAgentBranchAutoName.placeholderBranchName,
      attemptedAt: options.attemptedAt ?? new Date().toISOString(),
    },
    ...(current.runtime ? { runtime: current.runtime } : {}),
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
