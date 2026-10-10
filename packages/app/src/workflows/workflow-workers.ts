import type { Run } from "@otto-code/protocol/workflow";

/**
 * Every chat that worked for a run: each phase's candidates and the judges
 * that graded them. The conductor is not a worker: it is the chat that declared
 * the run, and none of its spend belongs to the run.
 */
export function collectWorkflowWorkerAgentIds(run: Pick<Run, "phases">): Set<string> {
  const ids = new Set<string>();
  for (const phase of run.phases) {
    for (const candidate of phase.candidates ?? []) {
      ids.add(candidate.agentId);
      for (const judgeId of candidate.judgeAgentIds ?? []) {
        ids.add(judgeId);
      }
    }
  }
  return ids;
}
