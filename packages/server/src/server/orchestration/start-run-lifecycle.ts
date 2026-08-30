import type { Run } from "@otto-code/protocol/orchestration";

import { summarizeRunOutput, type OrchestrationLogger } from "./run-engine.js";

// `start_run` owns a fleet of short-lived worker chats, but it deliberately
// suppresses their individual notify-on-finish reports. This helper restores
// exactly one hand-back for the whole run while leaving graph orchestration's
// per-node callback contract alone.
export interface StartRunLifecyclePort {
  /** True while the conductor's original start_workflow tool call can return normally. */
  conductorHasInFlightTurn(): boolean;
  /** Queue one aggregate terminal report to a conductor whose original turn is gone. */
  notifyConductor(text: string): Promise<void>;
  /** Retire a settled run worker after the terminal Run is persisted. */
  archiveWorker(agentId: string): Promise<void>;
  logger: OrchestrationLogger;
}

const RUN_RESULT_MAX_CHARS = 4_000;

function truncateResult(text: string): string {
  return text.length <= RUN_RESULT_MAX_CHARS
    ? text
    : `${text.slice(0, RUN_RESULT_MAX_CHARS)}\n… (truncated; use get_run_status for the full result)`;
}

export function formatStartRunCompletionNotification(run: Run): string {
  const result = summarizeRunOutput(run);
  const details = [
    `The orchestration run "${run.title}" (${run.id}) finished with status ${run.status}.`,
    ...(run.error ? [`Reason: ${run.error}`] : []),
    ...(result ? [`<run-result>\n${truncateResult(result)}\n</run-result>`] : []),
    "Review the result and report the outcome to the user.",
  ];
  return details.join("\n\n");
}

/**
 * Attach the lifecycle unique to AI-declared `start_workflow` plans.
 *
 * The normal path returns the tool result into the conductor's still-live turn,
 * so sending another prompt would create a duplicate follow-up. If that turn
 * has ended before the run settles (provider/tool interruption, or a gate that
 * was later approved), a single queued system prompt is the durable hand-back.
 */
export function attachStartRunLifecycle(input: {
  runId: string;
  settled: Promise<Run>;
  conductorAgentId?: string;
  workerAgentIds: ReadonlySet<string>;
  port: StartRunLifecyclePort;
}): void {
  void input.settled
    .then(async (run) => {
      // `RunService` persists the terminal projection before resolving
      // `settled`, so archived workers can never take their durable results
      // away with them.
      const retirements = await Promise.allSettled(
        [...input.workerAgentIds].map(async (agentId) => {
          await input.port.archiveWorker(agentId);
        }),
      );
      for (const [index, retirement] of retirements.entries()) {
        if (retirement.status === "rejected") {
          input.port.logger.warn(
            {
              err: retirement.reason,
              agentId: [...input.workerAgentIds][index],
              runId: input.runId,
            },
            "Could not archive completed Workflow worker",
          );
        }
      }

      if (!input.conductorAgentId || input.port.conductorHasInFlightTurn()) {
        return undefined;
      }
      try {
        await input.port.notifyConductor(formatStartRunCompletionNotification(run));
      } catch (error) {
        input.port.logger.error(
          { err: error, runId: input.runId, conductorAgentId: input.conductorAgentId },
          "Could not notify Workflow conductor of completion",
        );
      }
      return undefined;
    })
    .catch((error) => {
      // RunService's settled promise is specified to resolve, but retain a
      // guardrail here so a future contract change cannot cause an unhandled
      // rejection in the tool host.
      input.port.logger.error({ err: error, runId: input.runId }, "Workflow lifecycle failed");
      return undefined;
    });
}
