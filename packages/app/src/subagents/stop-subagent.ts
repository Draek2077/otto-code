import type { Agent } from "@/stores/session-store";

/**
 * Stop is the running-state counterpart to archive (see archive-subagent.ts):
 * it transitions a live subagent to a terminal state without removing the row.
 * Observed subagents resolve to the provider `stopTask`; native subagents
 * cancel their run. Neither confirms — stopping is a benign, reversible-in-kind
 * gesture, matching the observed pane's Stop button.
 * See docs/agent-lifecycle.md (Item 2).
 */
export interface StopSubagentTarget {
  attend?: Agent["attend"] | null;
}

export interface StopSubagentDeps {
  getSubagent: (subagentId: string) => StopSubagentTarget | undefined;
  stopObservedSubagent: (subagentId: string) => Promise<void>;
  // Resolves with whether an in-flight run was actually interrupted; `cancelled`
  // is absent when the daemon predates the flag.
  cancelAgent: (subagentId: string) => Promise<{ cancelled?: boolean } | void>;
  reportError: (error: unknown) => void;
  // Called when the daemon reports there was no run to interrupt (the row was
  // already finished, or still initializing) — otherwise Stop is a dead click
  // with no feedback. See docs/agent-lifecycle.md (Item 2).
  reportNothingToStop: () => void;
}

export interface RequestStopSubagentInput {
  serverId: string;
  subagentId: string;
}

export async function requestStopSubagent(
  input: RequestStopSubagentInput,
  deps: StopSubagentDeps,
): Promise<void> {
  const subagent = deps.getSubagent(input.subagentId);
  try {
    if (subagent?.attend === "observed") {
      await deps.stopObservedSubagent(input.subagentId);
    } else {
      const result = await deps.cancelAgent(input.subagentId);
      if (result && result.cancelled === false) {
        deps.reportNothingToStop();
      }
    }
  } catch (error) {
    deps.reportError(error);
  }
}
