import {
  DEFAULT_WORKFLOW_LIMITS,
  type WorkflowAuthoredDocument,
  type WorkflowEntry,
  type WorkflowRef,
  type WorkflowLaunch,
} from "@getpaseo/plugin/otto/workflows";
export const scope = { hostId: "host", projectId: "project" };
export const reference: WorkflowRef = {
  scope,
  kind: "ai",
  id: "example",
  location: "repository",
  storeKey: "repo",
};
export function authored(): WorkflowAuthoredDocument {
  const seat = { provider: "fixture", model: "model" };
  return {
    kind: "ai",
    value: {
      format: "otto.workflow.ai",
      formatVersion: 1,
      id: "example",
      title: "Original",
      prompt: "Read then report",
      seats: { conductor: seat, worker: seat, judge: seat },
      limits: { ...DEFAULT_WORKFLOW_LIMITS },
      autopilot: false,
      createdAt: "now",
      updatedAt: "now",
      unknown: { retain: 1 },
    },
  };
}
export function entry(): WorkflowEntry {
  return { ref: reference, revision: "origin", document: authored() };
}
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}
export function reviewed(launch: WorkflowLaunch) {
  return {
    token: "review-token",
    launch,
    issues: [],
    warnings: [],
    agentCount: 1,
    fanOutCount: 0,
    expiresAt: "tomorrow",
  };
}
