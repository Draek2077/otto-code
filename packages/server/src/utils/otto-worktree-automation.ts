import type { UntrustedWorkspaceSource } from "../server/workspace-automation-gate.js";
import type { WorktreeSource } from "./worktree.js";

/** Keep eager creation and persisted setup approval on the same source identity. */
export function getUntrustedWorktreeSource(
  source: WorktreeSource,
): UntrustedWorkspaceSource | undefined {
  if (source.kind === "checkout-change-request" && source.headRepository) {
    return {
      kind: "change_request",
      forge: source.forge,
      number: source.changeRequestNumber,
      headRepository: source.headRepository,
    };
  }
  // Otto's internal legacy source still accepts contributor-owned GitHub heads.
  // It has no repository-name field; preserve its known owner as the approval identity.
  if (source.kind === "checkout-github-pr" && source.headRepositoryOwner) {
    return {
      kind: "change_request",
      forge: "github",
      number: source.githubPrNumber,
      headRepository: source.headRepositoryOwner,
    };
  }
  return undefined;
}
