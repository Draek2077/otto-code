// Pure transition logic for the tutorial store, kept separate so it can be
// unit-tested without a zustand instance (mirrors stores/panel-store/state.ts).

export type TutorialStatus = "idle" | "running" | "completed";

export interface TutorialSnapshot {
  status: TutorialStatus;
  stepIndex: number;
}

// Start is a no-op unless idle, so a stray second start() (e.g. the launch gate
// firing twice) never restarts a tour already in progress or already finished.
export function reduceStart(snapshot: TutorialSnapshot): TutorialSnapshot {
  if (snapshot.status !== "idle") {
    return snapshot;
  }
  return { status: "running", stepIndex: 0 };
}

export function reduceNext(snapshot: TutorialSnapshot): TutorialSnapshot {
  if (snapshot.status !== "running") {
    return snapshot;
  }
  return { status: "running", stepIndex: snapshot.stepIndex + 1 };
}

export function reduceGoToStep(snapshot: TutorialSnapshot, index: number): TutorialSnapshot {
  if (snapshot.status !== "running") {
    return snapshot;
  }
  return { status: "running", stepIndex: Math.max(0, index) };
}

// Both exit (user bailed) and complete (reached the end) land on the same
// terminal state; the persisted `hasCompletedTutorial` flag is what actually
// prevents a re-run. Kept as two store methods for call-site clarity.
export function reduceComplete(snapshot: TutorialSnapshot): TutorialSnapshot {
  return { status: "completed", stepIndex: snapshot.stepIndex };
}

export function reduceExit(): TutorialSnapshot {
  return { status: "completed", stepIndex: 0 };
}
