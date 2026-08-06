import { describe, expect, it } from "vitest";
import {
  BRAIN_STATE_LABELS,
  BRAIN_STATE_VISUALS,
  BRAIN_DISABLED_LABEL,
  deriveBrainState,
  isBusyBrainState,
  resolveBrainRailLabel,
  resolveBrainRailPresentation,
  type BrainState,
} from "@/components/brain/brain-state";

const READY = { running: true, reachable: true, state: "ready" } as const;

describe("deriveBrainState", () => {
  it("reads a missing or stopped host as off", () => {
    expect(deriveBrainState(null)).toBe("off");
    expect(deriveBrainState({ running: false })).toBe("off");
    expect(deriveBrainState({ running: true, state: "stopped" })).toBe("off");
  });

  it("separates a brain it cannot reach from one that is deliberately off", () => {
    expect(deriveBrainState({ running: true, reachable: false })).toBe("unreachable");
    // What BrainManager.remoteStatus actually sends for a remote that did not answer.
    expect(deriveBrainState({ running: false, reachable: false, state: "unreachable" })).toBe(
      "unreachable",
    );
  });

  it("reads a remote that was never pointed anywhere as off, not unreachable", () => {
    expect(deriveBrainState({ running: false, reachable: false, state: "unconfigured" })).toBe(
      "off",
    );
  });

  it("shows a brain whose process is up but not yet bound as loading, not off", () => {
    // BrainManager sends running:false here because the host API has not
    // answered, but the child is alive and coming up. Reading that as "off"
    // would blank the rail for the whole of every start.
    expect(deriveBrainState({ running: false, reachable: false, state: "starting" })).toBe(
      "loading",
    );
  });

  it("reports the supervisor's own failure as an error", () => {
    expect(deriveBrainState({ ...READY, state: "failed" })).toBe("error");
  });

  it("maps the supervisor's transitions to load and unload", () => {
    expect(deriveBrainState({ ...READY, state: "starting" })).toBe("loading");
    expect(deriveBrainState({ ...READY, state: "stopping" })).toBe("unloading");
  });

  it("splits prefill from generation by slot phase", () => {
    expect(deriveBrainState({ ...READY, slots: { prefill: 1, decode: 0 } })).toBe("prefill");
    expect(deriveBrainState({ ...READY, slots: { prefill: 0, decode: 1 } })).toBe("generating");
  });

  it("prefers thinking over generating while a slot is reasoning", () => {
    expect(deriveBrainState({ ...READY, reasoning: true, slots: { decode: 1 } })).toBe("thinking");
  });

  it("uses host API v2 request stages before slot sampling catches up", () => {
    expect(
      deriveBrainState({
        ...READY,
        slots: { prefill: 0, decode: 0 },
        inference: { processing: 1, thinking: 0, generating: 0 },
      }),
    ).toBe("prefill");
    expect(
      deriveBrainState({
        ...READY,
        slots: { prefill: 0, decode: 0 },
        inference: { processing: 0, thinking: 1, generating: 0 },
      }),
    ).toBe("thinking");
    expect(
      deriveBrainState({
        ...READY,
        slots: { prefill: 0, decode: 0 },
        inference: { processing: 0, thinking: 0, generating: 1 },
      }),
    ).toBe("generating");
  });

  it("shows queued work that has no slot yet", () => {
    expect(deriveBrainState({ ...READY, queued: 2 })).toBe("queued");
    // A queued job behind a slot that is already running is still generation:
    // the rail reports what the host is doing, not what it will do next.
    expect(deriveBrainState({ ...READY, queued: 2, slots: { decode: 1 } })).toBe("generating");
  });

  it("lets a long-running op outrank every busy signal it produces", () => {
    // A benchmark loads models and runs completions through them. Deriving from
    // the raw signals would flicker the rail for the whole run.
    const benchmarking = {
      ...READY,
      state: "starting",
      queued: 4,
      reasoning: true,
      slots: { prefill: 1, decode: 1 },
      activity: { kind: "benchmark" },
    };
    expect(deriveBrainState(benchmarking)).toBe("benchmarking");
    expect(deriveBrainState({ ...READY, activity: { kind: "calibrate" } })).toBe("calibrating");
    expect(deriveBrainState({ ...READY, activity: { kind: "sweep" } })).toBe("sweeping");
    expect(deriveBrainState({ ...READY, activity: { kind: "download" } })).toBe("downloading");
    expect(deriveBrainState({ ...READY, activity: { kind: "scan" } })).toBe("scanning");
  });

  it("keeps showing the op while it swaps models mid-run", () => {
    // The supervisor reports `starting` on every model load a benchmark does.
    // The op has to win, or the rail flickers for the whole run.
    expect(deriveBrainState({ ...READY, state: "starting", activity: { kind: "benchmark" } })).toBe(
      "benchmarking",
    );
  });

  it("ignores an activity kind it does not know", () => {
    expect(deriveBrainState({ ...READY, activity: { kind: "defragment" } })).toBe("idle");
  });

  it("surfaces a stale error only once the host is otherwise idle", () => {
    expect(deriveBrainState({ ...READY, lastError: "cuda oom" })).toBe("degraded");
    expect(deriveBrainState({ ...READY, lastError: "cuda oom", slots: { decode: 1 } })).toBe(
      "generating",
    );
  });

  it("reads a ready, quiet host as idle", () => {
    expect(deriveBrainState(READY)).toBe("idle");
  });

  it("returns idle rather than guessing when the busy signals are absent", () => {
    // The prefill/decode split, the reasoning flag and the activity record are
    // newer than the status RPC. A brain that reports none of them must read as
    // idle, never as a fabricated busy state.
    expect(deriveBrainState({ running: true, reachable: true, state: "ready" })).toBe("idle");
  });
});

describe("brain state visuals", () => {
  const states = Object.keys(BRAIN_STATE_VISUALS) as BrainState[];

  it("labels and draws every state", () => {
    for (const state of states) {
      expect(BRAIN_STATE_LABELS[state]).toBeTruthy();
      expect(BRAIN_STATE_VISUALS[state].glyph).toBeTruthy();
    }
  });

  it("holds the lifecycle states still and moves every busy one", () => {
    for (const state of ["off", "unreachable", "idle", "degraded", "error"] as BrainState[]) {
      expect(isBusyBrainState(state)).toBe(false);
    }
    for (const state of [
      "loading",
      "unloading",
      "queued",
      "prefill",
      "thinking",
      "generating",
      "downloading",
      "scanning",
      "calibrating",
      "sweeping",
      "benchmarking",
    ] as BrainState[]) {
      expect(isBusyBrainState(state)).toBe(true);
    }
  });

  it("gives every travelling state a peak colour and a real duration", () => {
    for (const state of states) {
      const visual = BRAIN_STATE_VISUALS[state];
      if (visual.motion === null || visual.motion === "pulse") {
        continue;
      }
      expect(visual.peak).toMatch(/^#[0-9a-f]{6}$/i);
      expect(visual.durationMs).toBeGreaterThan(0);
    }
  });

  it("gives every state that needs its own mark a distinct one", () => {
    // Either a family variant or a mark in the gap, never neither: these six are
    // the states a glance has to tell apart, and tint alone does not carry that
    // at rail size.
    const owners = [
      "error",
      "downloading",
      "scanning",
      "calibrating",
      "sweeping",
      "benchmarking",
    ] as const;
    const marks = owners.map(
      (state) => `${BRAIN_STATE_VISUALS[state].glyph}/${BRAIN_STATE_VISUALS[state].badge ?? "-"}`,
    );
    expect(new Set(marks).size).toBe(owners.length);
    for (const mark of marks) {
      expect(mark).not.toBe("brain/-");
    }
  });

  it("badges only the two ops the family ships no variant for", () => {
    const badged = (Object.keys(BRAIN_STATE_VISUALS) as BrainState[]).filter(
      (state) => BRAIN_STATE_VISUALS[state].badge !== null,
    );
    expect(badged.sort()).toEqual(["calibrating", "sweeping"]);
    // The mark sits in a gap bitten out of the base brain, so a state with both
    // a variant glyph and a badge would punch a hole through the variant's own
    // mark.
    for (const state of badged) {
      expect(BRAIN_STATE_VISUALS[state].glyph).toBe("brain");
    }
  });

  it("leaves every state that needs no mark on the plain brain", () => {
    for (const state of [
      "off",
      "unreachable",
      "idle",
      "degraded",
      "loading",
      "unloading",
      "queued",
      "prefill",
      "thinking",
      "generating",
    ] as BrainState[]) {
      expect(BRAIN_STATE_VISUALS[state].glyph).toBe("brain");
      expect(BRAIN_STATE_VISUALS[state].badge).toBeNull();
    }
  });

  it("gives tokens in and tokens out opposite directions", () => {
    expect(BRAIN_STATE_VISUALS.prefill.motion).toBe("left-to-right");
    expect(BRAIN_STATE_VISUALS.generating.motion).toBe("right-to-left");
    expect(BRAIN_STATE_VISUALS.loading.motion).toBe("bottom-to-top");
    expect(BRAIN_STATE_VISUALS.unloading.motion).toBe("top-to-bottom");
  });
});

describe("Brain rail enablement", () => {
  it("keeps a disabled Brain grey and labels it as disabled", () => {
    expect(resolveBrainRailPresentation("idle", false)).toEqual({
      state: "off",
      label: BRAIN_DISABLED_LABEL,
      disabled: true,
    });
  });

  it("preserves the live state until the enablement setting has loaded", () => {
    expect(resolveBrainRailPresentation("generating", undefined)).toEqual({
      state: "generating",
      label: null,
      disabled: false,
    });
  });
});

describe("resolveBrainRailLabel", () => {
  it("reads as navigation while the brain is merely idle", () => {
    expect(resolveBrainRailLabel(resolveBrainRailPresentation("idle", true), "Brain")).toBe(
      "Brain",
    );
    // No bundle to draw on (the title-bar button) falls back to the same word.
    expect(resolveBrainRailLabel(resolveBrainRailPresentation("idle", true))).toBe("Brain");
  });

  it("says what the brain is doing as soon as there is something to say", () => {
    expect(resolveBrainRailLabel(resolveBrainRailPresentation("generating", true), "Brain")).toBe(
      BRAIN_STATE_LABELS.generating,
    );
  });

  it("lets the disabled wording win over both the idle label and the state's own", () => {
    expect(resolveBrainRailLabel(resolveBrainRailPresentation("generating", false), "Brain")).toBe(
      BRAIN_DISABLED_LABEL,
    );
  });
});
