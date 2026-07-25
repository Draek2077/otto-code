import { i18n } from "@/i18n/i18next";
import type { Agent } from "@/stores/session-store";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

export interface ResolveArchiveSubagentDialogInput {
  title: Agent["title"] | null | undefined;
  status: Agent["status"] | null | undefined;
}

function resolveSubagentLabel(title: Agent["title"] | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent" || normalized.toLowerCase() === "new chat") {
    return null;
  }
  return normalized;
}

export function resolveArchiveSubagentDialog(
  input: ResolveArchiveSubagentDialogInput,
): ConfirmDialogInput {
  const subject = resolveSubagentLabel(input.title) ?? i18n.t("subagents.dialogs.subjectFallback");
  const isRunning = input.status === "running";

  return {
    title: isRunning
      ? i18n.t("subagents.dialogs.archive.titleRunning")
      : i18n.t("subagents.dialogs.archive.title"),
    message: isRunning
      ? i18n.t("subagents.dialogs.archive.messageRunning", { subject })
      : i18n.t("subagents.dialogs.archive.message", { subject }),
    confirmLabel: i18n.t("subagents.dialogs.archive.confirm"),
    cancelLabel: i18n.t("common.actions.cancel"),
    destructive: true,
  };
}

export interface ArchiveSubagentDeps {
  getSubagent: (subagentId: string) => ResolveArchiveSubagentDialogInput | undefined;
  confirm: (input: ConfirmDialogInput) => Promise<boolean>;
  archiveAgent: (input: { serverId: string; agentId: string }) => Promise<void>;
  reportError: (error: unknown) => void;
}

export interface RequestArchiveSubagentInput {
  serverId: string;
  subagentId: string;
}

export async function requestArchiveSubagent(
  input: RequestArchiveSubagentInput,
  deps: ArchiveSubagentDeps,
): Promise<void> {
  const subagent = deps.getSubagent(input.subagentId);
  const confirmed = await deps.confirm(
    resolveArchiveSubagentDialog({
      title: subagent?.title,
      status: subagent?.status,
    }),
  );
  if (!confirmed) {
    return;
  }
  try {
    await deps.archiveAgent({ serverId: input.serverId, agentId: input.subagentId });
  } catch (error) {
    deps.reportError(error);
  }
}
