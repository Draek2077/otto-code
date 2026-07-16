import type { ConfirmDialogInput } from "@/utils/confirm-dialog";
import type { RecordClearedInput } from "./cleared-subagent-tokens-store";

/**
 * Bulk "Clear all completed": archive every terminal (completed) subagent row
 * in one gesture. Only ever called with tidy-eligible rows (terminal, not
 * attention) — it never touches a running or errored row. Confirms once because
 * archiving many rows at once is more consequential than a single archive.
 * See docs/agent-lifecycle.md (the sub-agents track).
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

/** A row that can be cleared — its id and (optional) running token total. */
export interface ClearableSubagentRow {
  id: string;
  cumulativeTokens?: number;
}

export interface ClearCompletedSubagentsDeps {
  archiveAgent: (input: { serverId: string; agentId: string }) => Promise<void>;
  // Rolls a cleared row's tokens into the parent tally so the track header total
  // survives the archive. See cleared-subagent-tokens-store.ts.
  recordCleared: (input: RecordClearedInput) => void;
  reportError: (error: unknown) => void;
}

export interface ClearCompletedSubagentsInput {
  serverId: string;
  parentAgentId: string;
  rows: readonly ClearableSubagentRow[];
}

/**
 * Core clear: archive each row and, only on a successful archive, roll its tokens
 * into the parent tally. A failed archive leaves the row live (still counted
 * normally) and records nothing, so the header stays exactly correct either way.
 * No confirmation — the auto-clear driver and the confirming manual wrapper both
 * funnel through here.
 */
export async function clearCompletedSubagents(
  input: ClearCompletedSubagentsInput,
  deps: ClearCompletedSubagentsDeps,
): Promise<void> {
  await Promise.all(
    input.rows.map(async (row) => {
      try {
        await deps.archiveAgent({ serverId: input.serverId, agentId: row.id });
        deps.recordCleared({
          serverId: input.serverId,
          parentAgentId: input.parentAgentId,
          rows: [row],
        });
      } catch (error) {
        deps.reportError(error);
      }
    }),
  );
}

export interface RequestClearCompletedSubagentsDeps extends ClearCompletedSubagentsDeps {
  confirm: (input: ConfirmDialogInput) => Promise<boolean>;
}

/** Manual "Clear all completed": confirm once, then run the core clear. */
export async function requestClearCompletedSubagents(
  input: ClearCompletedSubagentsInput,
  deps: RequestClearCompletedSubagentsDeps,
): Promise<void> {
  if (input.rows.length === 0) {
    return;
  }
  const confirmed = await deps.confirm(resolveClearCompletedDialog(input.rows.length));
  if (!confirmed) {
    return;
  }
  await clearCompletedSubagents(input, deps);
}
