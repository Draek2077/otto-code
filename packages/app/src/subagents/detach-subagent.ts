import { i18n } from "@/i18n/i18next";
import type { Agent } from "@/stores/session-store";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

export interface ResolveDetachSubagentDialogInput {
  title: Agent["title"] | null | undefined;
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

export function resolveDetachSubagentDialog(
  input: ResolveDetachSubagentDialogInput,
): ConfirmDialogInput {
  const subject =
    resolveSubagentLabel(input.title) ?? i18n.t("subagents.dialogs.subjectFallbackCapitalized");

  return {
    title: i18n.t("subagents.dialogs.detach.title"),
    message: i18n.t("subagents.dialogs.detach.message", { subject }),
    confirmLabel: i18n.t("subagents.dialogs.detach.confirm"),
    cancelLabel: i18n.t("common.actions.cancel"),
    destructive: false,
  };
}

export interface DetachSubagentDeps {
  getSubagent: (subagentId: string) => ResolveDetachSubagentDialogInput | undefined;
  confirm: (input: ConfirmDialogInput) => Promise<boolean>;
  detachAgent: (input: { serverId: string; agentId: string }) => Promise<void>;
  openDetachedAgent: (input: { serverId: string; agentId: string }) => void;
  reportError: (error: unknown) => void;
}

export interface RequestDetachSubagentInput {
  serverId: string;
  subagentId: string;
}

export async function requestDetachSubagent(
  input: RequestDetachSubagentInput,
  deps: DetachSubagentDeps,
): Promise<void> {
  const subagent = deps.getSubagent(input.subagentId);
  const confirmed = await deps.confirm(
    resolveDetachSubagentDialog({
      title: subagent?.title,
    }),
  );
  if (!confirmed) {
    return;
  }
  try {
    await deps.detachAgent({ serverId: input.serverId, agentId: input.subagentId });
    deps.openDetachedAgent({ serverId: input.serverId, agentId: input.subagentId });
  } catch (error) {
    deps.reportError(error);
  }
}
