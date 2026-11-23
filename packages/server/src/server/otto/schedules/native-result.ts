import type { AgentRunResult } from "../../agent/agent-sdk-types.js";
import { curateAgentActivity } from "../../agent/activity-curator.js";
import { ScheduleExecutionError } from "./runtime.js";

/** Only the captured foreground result is attributable to this attempt. */
export function scheduleNativeResult(agentId: string, result: AgentRunResult) {
  if (result.canceled)
    throw new ScheduleExecutionError(
      "Scheduled native turn was canceled. Completed effects are retained.",
      "canceled",
    );
  return {
    agentId,
    output: result.finalText.trim() || curateAgentActivity(result.timeline).trim() || null,
  };
}
