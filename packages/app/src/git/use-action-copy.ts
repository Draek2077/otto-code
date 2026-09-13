import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useIsDeveloperMode } from "@/hooks/use-interface-mode";
import { BACKUP_ACTION_LABELS } from "./backup-policy";

// Otto's presentation seam: the shared action handlers retain their confirmation,
// error handling and execution flow. Only their user-facing vocabulary changes.
const BACKUP_COPY: Record<string, string> = {
  "workspace.git.actions.commit.success": BACKUP_ACTION_LABELS.commit.successLabel,
  "workspace.git.actions.pull.success": BACKUP_ACTION_LABELS.pull.successLabel,
  "workspace.git.actions.push.success": BACKUP_ACTION_LABELS.push.successLabel,
  "workspace.git.actions.fetch.success": BACKUP_ACTION_LABELS.fetch.successLabel,
  "workspace.git.actions.toasts.failedCommit": "Could not save this version",
  "workspace.git.actions.toasts.failedPull": "Could not download updates",
  "workspace.git.actions.toasts.failedPush": "Could not upload the backup",
  "workspace.git.actions.toasts.failedFetch": "Could not check for updates",
  "workspace.git.commitAgent.confirmTitle": "Save version",
  "workspace.git.commitAgent.confirmCta": "Save version",
  "workspace.git.commitAgent.messagePersonality":
    "Save all changed files as a local version. {{name}} will write its description. Upload separately to keep a remote backup.",
  "workspace.git.commitAgent.messageProvider":
    "Save all changed files as a local version. {{detail}} will write its description. Upload separately to keep a remote backup.",
  "workspace.git.commitAgent.noneTitle": "Choose an agent for version descriptions",
  "workspace.git.commitAgent.noneMessage":
    "Choose an agent in Host Settings to describe your saved versions, then try saving again.",
};

export function useGitActionCopy() {
  const { t: translate } = useTranslation();
  const isDeveloperMode = useIsDeveloperMode();
  const t = useCallback(
    (key: string, options?: Record<string, unknown>): string => {
      if (!isDeveloperMode && BACKUP_COPY[key]) {
        return translate(`workspace.backups.${key.split(".").slice(2).join(".")}`, {
          defaultValue: BACKUP_COPY[key],
          ...options,
        });
      }
      return translate(key, options);
    },
    [isDeveloperMode, translate],
  );
  return { t, isDeveloperMode };
}
