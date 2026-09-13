import type { BuildGitActionsInput, GitAction, GitActionId, GitActions } from "./policy";

// User Mode describes outcomes. The underlying actions and their runtime state
// remain shared with Developer Mode; no separate Git execution path lives here.
export const BACKUP_ACTION_LABELS = {
  commit: {
    label: "Save version",
    pendingLabel: "Saving version…",
    successLabel: "Version saved",
    description: "Save changed files as a local version.",
  },
  fetch: {
    label: "Check for updates",
    pendingLabel: "Checking…",
    successLabel: "Checked for updates",
    description: "Look for newer versions in the remote backup.",
  },
  pull: {
    label: "Download updates",
    pendingLabel: "Downloading…",
    successLabel: "Updates downloaded",
    description: "Apply newer versions from the remote backup.",
  },
  push: {
    label: "Upload changes",
    pendingLabel: "Uploading…",
    successLabel: "Changes uploaded",
    description: "Upload saved changes to the remote backup.",
  },
} as const;

type BackupActionId = keyof typeof BACKUP_ACTION_LABELS;

export function getBackupWorkspaceMessage(input: {
  isGit: boolean;
  currentBranch: string | null | undefined;
  isWorktree: boolean;
}): string | null {
  if (!input.isGit) return "Ask an agent to set up backups for this project.";
  if (input.isWorktree || (input.currentBranch !== "main" && input.currentBranch !== "master")) {
    return "Use this project's main workspace for backups.";
  }
  return null;
}

export function buildBackupActions(
  input: BuildGitActionsInput,
  workspaceMessage: string | null,
): GitActions {
  if (!input.isGit) return { primary: null, secondary: [], menu: [] };
  const busy = Object.values(input.runtime).some((action) => action.status === "pending");
  const action = (id: BackupActionId): GitAction => ({
    id,
    ...BACKUP_ACTION_LABELS[id],
    ...input.runtime[id],
    startsGroup: false,
    disabled: input.runtime[id].disabled || busy || Boolean(workspaceMessage),
    unavailableMessage: workspaceMessage ?? unavailable(id, input),
  });
  const primary = action("commit");
  const secondary = [
    ...(input.gitFetchEnabled && input.hasRemote ? [action("fetch")] : []),
    action("pull"),
    action("push"),
  ];
  return { primary, secondary, menu: [] };
}

function unavailable(id: GitActionId, input: BuildGitActionsInput): string | undefined {
  if (id === "commit") {
    return input.hasUncommittedChanges ? undefined : "No changes to save.";
  }
  if (!input.hasRemote) {
    return "This project has local version history only. Ask an agent to connect a remote backup.";
  }
  if (id === "pull" && input.hasUncommittedChanges) {
    return "Save a version before downloading.";
  }
  if (id === "push" && (input.behindOfOrigin ?? 0) > 0) {
    return "Download the newer versions before uploading.";
  }
  return undefined;
}
