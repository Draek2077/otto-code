import type { BuildGitActionsInput, GitAction, GitActionId, GitActions } from "./policy";

// User Mode describes outcomes. The underlying actions and their runtime state
// remain shared with Developer Mode; no separate Git execution path lives here.
export const BACKUP_ACTION_LABELS = {
  commit: {
    label: "Save version",
    pendingLabel: "Saving version…",
    successLabel: "Version saved",
    description:
      "Save all changed files in a local version. Upload separately to keep a remote backup.",
  },
  fetch: {
    label: "Check for updates",
    pendingLabel: "Checking…",
    successLabel: "Checked for updates",
    description: "Check the remote backup for new versions without changing your files.",
  },
  pull: {
    label: "Download updates",
    pendingLabel: "Downloading…",
    successLabel: "Updates downloaded",
    description: "Apply newer versions from the remote backup to your files.",
  },
  push: {
    label: "Upload backup",
    pendingLabel: "Uploading…",
    successLabel: "Backup uploaded",
    description: "Upload locally saved versions to the connected remote backup, such as GitHub.",
  },
} as const;

type BackupActionId = keyof typeof BACKUP_ACTION_LABELS;

export function getBackupWorkspaceMessage(input: {
  isGit: boolean;
  currentBranch: string | null | undefined;
  isWorktree: boolean;
}): string | null {
  if (!input.isGit)
    return "Backups are not set up for this project yet. Ask an agent to help set them up.";
  if (input.isWorktree || (input.currentBranch !== "main" && input.currentBranch !== "master")) {
    return "Backups are available from this project's main workspace. Your current files stay available here.";
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
    return input.hasUncommittedChanges ? undefined : "Your files have no changes to save.";
  }
  if (!input.hasRemote) {
    return "This project has local version history only. Ask an agent to help connect a remote backup, such as GitHub, to upload and download versions.";
  }
  if (id === "pull" && input.hasUncommittedChanges) {
    return "Save a version of your changes before downloading updates.";
  }
  if (id === "push" && (input.behindOfOrigin ?? 0) > 0) {
    return "Download the newer versions before uploading your backup.";
  }
  return undefined;
}
