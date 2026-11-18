import { runGitCommand } from "../../../utils/run-git-command.js";
import { resolveRepositoryDefaultBranch } from "../../../utils/checkout-git.js";
import { writeComparisonBase } from "./comparison-base-store.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";

export async function setComparisonBaseAndRefresh(
  cwd: string,
  input: { branchName: string; baseRef: string | null },
  owner: Pick<WorkspaceGitService, "getSnapshot">,
) {
  const selected = await setComparisonBase(cwd, input);
  // Ordinary refreshes can be throttled or join a read started before the write.
  // Keep the existing owner, but wait for a subsequent forced structural snapshot.
  await owner.getSnapshot(cwd, {
    force: true,
    reason: "comparison-base-change",
    includeForge: false,
    queueIfBusy: true,
  });
  return selected;
}

export class ComparisonBaseError extends Error {}
export async function setComparisonBase(
  cwd: string,
  input: { branchName: string; baseRef: string | null },
) {
  const git = async (args: string[]) =>
    (
      await runGitCommand(args, {
        cwd,
        envOverlay: { GIT_OPTIONAL_LOCKS: "0" },
      })
    ).stdout.trim();
  const root = await git(["rev-parse", "--show-toplevel"]);
  const assertBranch = async () => {
    const branch = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => null);
    if (!branch || branch !== input.branchName)
      throw new ComparisonBaseError(
        "The working branch changed. Reopen the parent branch picker and try again.",
      );
  };
  await assertBranch();
  let ref = input.baseRef;
  if (ref === null) {
    const name = await resolveRepositoryDefaultBranch(cwd);
    if (!name)
      throw new ComparisonBaseError(
        "The repository default branch could not be found. Choose a branch instead.",
      );
    ref = name.startsWith("origin/") ? `refs/remotes/${name}` : `refs/heads/${name}`;
  }
  // Only literal branch refs enter revision expressions; never accept arbitrary Git revisions.
  if (!ref.startsWith("refs/heads/") && !ref.startsWith("refs/remotes/"))
    throw new ComparisonBaseError("Choose a local or remote branch.");
  try {
    await git(["check-ref-format", ref]);
    await git(["show-ref", "--verify", "--quiet", ref]);
  } catch {
    throw new ComparisonBaseError(
      "That parent branch no longer exists. Reopen the picker and choose another branch.",
    );
  }
  if (ref === `refs/heads/${input.branchName}`)
    throw new ComparisonBaseError("Choose a parent branch other than the working branch.");
  await assertBranch();
  writeComparisonBase(root, input.branchName, ref);
  return { branchName: input.branchName, baseRef: ref };
}
