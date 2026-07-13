import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

/**
 * Bulk "Clear all completed": archive every terminal (completed) subagent row
 * in one gesture. Only ever called with tidy-eligible ids (terminal, not
 * attention) — it never touches a running or errored row. Confirms once because
 * archiving many rows at once is more consequential than a single archive.
 * See projects/subagents-cleanup/subagents-cleanup.md (Item 6).
 */
export function resolveClearCompletedDialog(count: number): ConfirmDialogInput {
  const noun = count === 1 ? "completed subagent" : "completed subagents";
  return {
    title: count === 1 ? "Clear completed subagent?" : `Clear ${count} completed subagents?`,
    message: `Archive ${count} ${noun} and remove ${
      count === 1 ? "it" : "them"
    } from the track. Running subagents are untouched.`,
    confirmLabel: "Clear",
    cancelLabel: "Cancel",
    destructive: true,
  };
}

export interface ClearCompletedSubagentsDeps {
  confirm: (input: ConfirmDialogInput) => Promise<boolean>;
  archiveAgent: (input: { serverId: string; agentId: string }) => Promise<void>;
  reportError: (error: unknown) => void;
}

export interface RequestClearCompletedSubagentsInput {
  serverId: string;
  subagentIds: readonly string[];
}

export async function requestClearCompletedSubagents(
  input: RequestClearCompletedSubagentsInput,
  deps: ClearCompletedSubagentsDeps,
): Promise<void> {
  if (input.subagentIds.length === 0) {
    return;
  }
  const confirmed = await deps.confirm(resolveClearCompletedDialog(input.subagentIds.length));
  if (!confirmed) {
    return;
  }
  await Promise.all(
    input.subagentIds.map(async (agentId) => {
      try {
        await deps.archiveAgent({ serverId: input.serverId, agentId });
      } catch (error) {
        deps.reportError(error);
      }
    }),
  );
}
