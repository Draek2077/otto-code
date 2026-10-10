import type { Run } from "@otto-code/protocol/workflow";

import { summarizeRunOutput, type OrchestrationLogger } from "./workflow-engine.js";

// `start_run` owns a fleet of short-lived worker chats, but it deliberately
// suppresses their individual notify-on-finish reports. This helper restores
// exactly one hand-back for the whole run while leaving graph orchestration's
// per-node callback contract alone.
/**
 * Where the conductor's own `start_workflow` call stands. `awaiting`: still
 * blocked on the run, so it returns the result itself. `delivered`: it returned
 * a terminal run, result included. `returned-early`: it returned before the run
 * ended (a start confirmation or gate pause, or the wait limit), so nothing has
 * carried the result to the conductor yet.
 */
export type StartCallState = "awaiting" | "delivered" | "returned-early";

export interface StartRunLifecyclePort {
  /** The conductor's original start_workflow call, read when the run settles. */
  startCallState(): StartCallState;
  /** True while the conductor has any turn in flight. */
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
    : `${text.slice(0, RUN_RESULT_MAX_CHARS)}\n… (truncated; use get_workflow_status for the full result)`;
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
 * True when the conductor gets the result without a hand-back: its call
 * returned a terminal run, or it is still waiting inside a live turn.
 *
 * Being busy is not enough on its own. A call that returned at a pause leaves
 * the conductor free to start other work, and the run finishing during that
 * work used to read as "the original turn will return it" - dropping the
 * result. A waiting call whose turn is gone (an interrupted provider) cannot
 * return anything either, so it needs the hand-back too.
 */
export function startCallDeliversResult(
  state: StartCallState,
  conductorHasInFlightTurn: boolean,
): boolean {
  if (state === "delivered") {
    return true;
  }
  return state === "awaiting" && conductorHasInFlightTurn;
}

/**
 * Attach the lifecycle unique to AI-declared `start_workflow` plans.
 *
 * The normal path returns the tool result into the conductor's still-live turn,
 * so sending another prompt would create a duplicate follow-up. Whenever that
 * call cannot carry the result (it returned at a pause, or its turn ended), a
 * single queued system prompt is the durable hand-back. Queued delivery waits
 * for whatever the conductor is doing now, so it lands after that turn.
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

      if (
        !input.conductorAgentId ||
        startCallDeliversResult(input.port.startCallState(), input.port.conductorHasInFlightTurn())
      ) {
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
