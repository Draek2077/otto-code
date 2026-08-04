import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { z } from "zod";
import {
  getOttoWorktreeMetadataPath,
  validateBaseRefNameAllowingRemote,
} from "./worktree-metadata.js";

/**
 * Where the Changes view's base branch is remembered, keyed by branch.
 *
 * This deliberately does **not** live in `worktree.json`. That file is an Otto worktree's
 * identity record - it requires a `baseRefName` and is written at worktree creation - and a
 * plain checkout has no such record to extend. More importantly a plain checkout's gitdir is
 * shared by *every* branch you check out, so a single scalar base would bleed one branch's
 * comparison onto the next branch you switch to. Keying by branch name is what makes the base
 * picker work outside an Otto worktree at all.
 *
 * Both files sit under `<gitdir>/otto/`, so this reuses the same gitdir resolution and lands
 * per-worktree for linked worktrees and per-repo for a plain checkout - which is exactly the
 * scoping each one wants.
 */
const DiffBaseEntrySchema = z.object({
  ref: z.string().min(1),
  /**
   * `inferred` was detected from the commit graph and may be re-detected if the ref disappears.
   * `user` was picked explicitly and is only ever replaced by another explicit pick, or healed
   * when the branch it names stops existing.
   */
  source: z.enum(["inferred", "user"]),
});

const DiffBaseStoreSchema = z.object({
  version: z.literal(1),
  byBranch: z.record(z.string(), DiffBaseEntrySchema),
});

export type DiffBaseEntry = z.infer<typeof DiffBaseEntrySchema>;
export type DiffBaseSource = DiffBaseEntry["source"];

function getDiffBaseStorePath(worktreeRoot: string): string {
  // `worktree.json` already resolves the gitdir for both the `.git` directory and the
  // `.git` file (linked worktree) cases; sit beside it rather than repeating that logic.
  return join(dirname(getOttoWorktreeMetadataPath(worktreeRoot)), "diff-base.json");
}

/**
 * A malformed store degrades to "nothing remembered" rather than throwing.
 *
 * This is read on the path that renders the Changes view for every workspace. A corrupt
 * preference file is not a reason to fail the whole view - the base falls back through the
 * resolution ladder and the next explicit pick rewrites the file.
 */
function readDiffBaseStore(worktreeRoot: string): z.infer<typeof DiffBaseStoreSchema> | null {
  let storePath: string;
  try {
    storePath = getDiffBaseStorePath(worktreeRoot);
  } catch {
    return null;
  }
  if (!existsSync(storePath)) {
    return null;
  }
  try {
    return DiffBaseStoreSchema.parse(JSON.parse(readFileSync(storePath, "utf8")));
  } catch {
    return null;
  }
}

export function readStoredDiffBaseForBranch(
  worktreeRoot: string,
  branch: string,
): DiffBaseEntry | null {
  if (!branch) {
    return null;
  }
  return readDiffBaseStore(worktreeRoot)?.byBranch[branch] ?? null;
}

export function writeStoredDiffBaseForBranch(
  worktreeRoot: string,
  branch: string,
  entry: DiffBaseEntry,
): DiffBaseEntry {
  if (!branch) {
    throw new Error("Cannot store a diff base without a branch");
  }
  const ref = validateBaseRefNameAllowingRemote(entry.ref);
  const current = readDiffBaseStore(worktreeRoot);
  const next: z.infer<typeof DiffBaseStoreSchema> = {
    version: 1,
    byBranch: { ...current?.byBranch, [branch]: { ref, source: entry.source } },
  };

  const storePath = getDiffBaseStorePath(worktreeRoot);
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { ref, source: entry.source };
}

/** Drops a branch's remembered base so the resolution ladder decides again. */
export function clearStoredDiffBaseForBranch(worktreeRoot: string, branch: string): void {
  const current = readDiffBaseStore(worktreeRoot);
  if (!current?.byBranch[branch]) {
    return;
  }
  const { [branch]: _removed, ...rest } = current.byBranch;
  const storePath = getDiffBaseStorePath(worktreeRoot);
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify({ version: 1, byBranch: rest }, null, 2)}\n`, "utf8");
}
