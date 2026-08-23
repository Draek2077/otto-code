import { describe, expect, it } from "vitest";
import {
  BRAIN_STATE_LABELS,
  BRAIN_STATE_VISUALS,
  BRAIN_DISABLED_LABEL,
  deriveBrainActivity,
  deriveBrainState,
  isBusyBrainState,
  resolveBrainActivityLabel,
  resolveBrainRailLabel,
  resolveBrainRailPresentation,
  shouldShowBrainRail,
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

  it("does not move the rail from request-level stages alone", () => {
    // The `inference` counts track requests, which llama-server cannot express
    // per slot - so a request the proxy thinks is mid-thought must not flip
    // the rail to "thinking" while the Overview's own slot rows say "Decoding".
    // Until a request-to-slot join exists, only per-slot signals move the rail.
    expect(
      deriveBrainState({
        ...READY,
        slots: { prefill: 0, decode: 0 },
        inference: { processing: 1, thinking: 1, generating: 1 },
      }),
    ).toBe("idle");
  });

  it("reads the same per-slot signals the Overview panel's rows use", () => {
    // One request thinking while a slot is decoding: the panel's row says
    // "Decoding", so the rail says generating, not thinking.
    expect(
      deriveBrainState({
        ...READY,
        slots: { prefill: 0, decode: 1 },
        inference: { processing: 0, thinking: 1, generating: 0 },
      }),
    ).toBe("generating");
    expect(
      deriveBrainState({
        ...READY,
        slots: { prefill: 1, decode: 0 },
        inference: { processing: 0, thinking: 1, generating: 1 },
      }),
    ).toBe("prefill");
    // The reasoning flag is per-slot by construction (a reasoning delta on
    // this stream), so it stays the "thinking" signal.
    expect(
      deriveBrainState({
        ...READY,
        reasoning: true,
        slots: { prefill: 0, decode: 1 },
        inference: { processing: 0, thinking: 1, generating: 0 },
      }),
    ).toBe("thinking");
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

  it("uses the danger tint for an unreachable Brain", () => {
    expect(BRAIN_STATE_VISUALS.unreachable.tone).toBe("statusDanger");
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
  it("hides the rail only after the setting explicitly disables Brain", () => {
    expect(shouldShowBrainRail(undefined)).toBe(true);
    expect(shouldShowBrainRail(true)).toBe(true);
    expect(shouldShowBrainRail(false)).toBe(false);
  });

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
  it("carries the state's own sentence even while merely idle", () => {
    expect(resolveBrainRailLabel(resolveBrainRailPresentation("idle", true))).toBe(
      BRAIN_STATE_LABELS.idle,
    );
  });

  it("says what the brain is doing as soon as there is something to say", () => {
    expect(resolveBrainRailLabel(resolveBrainRailPresentation("generating", true))).toBe(
      BRAIN_STATE_LABELS.generating,
    );
  });

  it("lets the disabled wording win over the state's own", () => {
    expect(resolveBrainRailLabel(resolveBrainRailPresentation("generating", false))).toBe(
      BRAIN_DISABLED_LABEL,
    );
  });
});

describe("deriveBrainActivity", () => {
  const thread = (slot: number, phase: "prefill" | "decode") => ({ slot, phase });

  it("stays single for everything that is not slot work", () => {
    expect(deriveBrainActivity(null)).toEqual({ kind: "single", state: "off" });
    expect(deriveBrainActivity(READY)).toEqual({ kind: "single", state: "idle" });
    expect(deriveBrainActivity({ ...READY, state: "starting" })).toEqual({
      kind: "single",
      state: "loading",
    });
  });

  it("keeps a long-running op on the single glyph even while two slots serve it", () => {
    // A benchmark runs completions through both slots; the op owns the whole
    // host, so the halves must not describe its internals.
    expect(
      deriveBrainActivity({
        ...READY,
        slots: { prefill: 1, decode: 1, threads: [thread(0, "decode"), thread(1, "decode")] },
        activity: { kind: "benchmark" },
      }),
    ).toEqual({ kind: "single", state: "benchmarking" });
  });

  it("splits exactly two active slots, lowest id left", () => {
    // Order arrives as /slots lists it; the split is by id, not by position.
    expect(
      deriveBrainActivity({
        ...READY,
        slots: {
          prefill: 0,
          decode: 2,
          threads: [thread(3, "decode"), thread(1, "decode")],
        },
      }),
    ).toEqual({ kind: "split", slots: ["generating", "generating"] });
  });

  it("splits two slots doing different things", () => {
    expect(
      deriveBrainActivity({
        ...READY,
        slots: {
          prefill: 1,
          decode: 1,
          threads: [thread(0, "prefill"), thread(1, "decode")],
        },
      }),
    ).toEqual({ kind: "split", slots: ["prefill", "generating"] });
  });

  it("refines a decode half to thinking through the proxy join", () => {
    expect(
      deriveBrainActivity({
        ...READY,
        slots: {
          prefill: 0,
          decode: 2,
          threads: [thread(0, "decode"), thread(1, "decode")],
        },
        inference: { processing: 0, thinking: 1, generating: 1, slotStages: { "1": "thinking" } },
      }),
    ).toEqual({ kind: "split", slots: ["generating", "thinking"] });
  });

  it("counts active slots, not total slots", () => {
    // Four configured slots, one busy: the ordinary single glyph.
    expect(
      deriveBrainActivity({
        ...READY,
        slots: { prefill: 0, decode: 1, threads: [thread(2, "decode")] },
      }),
    ).toEqual({ kind: "single", state: "generating" });
    // Three configured slots, two busy: still the split.
    expect(
      deriveBrainActivity({
        ...READY,
        slots: {
          prefill: 0,
          decode: 2,
          threads: [thread(0, "decode"), thread(2, "decode")],
        },
      }),
    ).toEqual({ kind: "split", slots: ["generating", "generating"] });
  });

  it("goes to the spectrum at three or more active slots", () => {
    expect(
      deriveBrainActivity({
        ...READY,
        slots: {
          prefill: 1,
          decode: 2,
          threads: [thread(0, "prefill"), thread(1, "decode"), thread(2, "decode")],
        },
      }),
    ).toEqual({ kind: "spectrum", count: 3 });
    expect(
      deriveBrainActivity({
        ...READY,
        slots: {
          prefill: 0,
          decode: 4,
          threads: [
            thread(0, "decode"),
            thread(1, "decode"),
            thread(2, "decode"),
            thread(3, "decode"),
          ],
        },
      }),
    ).toEqual({ kind: "spectrum", count: 4 });
  });

  it("falls back to the single glyph without the busy rows", () => {
    // The aggregate counts say busy but `threads` (host API v2) is missing or
    // empty - an older brain, or the sub-second race at a request boundary.
    // The aggregate claim is the honest one; a guessed half would be a lie.
    expect(deriveBrainActivity({ ...READY, slots: { prefill: 0, decode: 2 } })).toEqual({
      kind: "single",
      state: "generating",
    });
    expect(
      deriveBrainActivity({
        ...READY,
        slots: { prefill: 0, decode: 2, threads: [] },
      }),
    ).toEqual({ kind: "single", state: "generating" });
    expect(deriveBrainActivity({ ...READY, queued: 1 })).toEqual({
      kind: "single",
      state: "queued",
    });
  });

  it("labels the split with each half's own words", () => {
    expect(resolveBrainActivityLabel({ kind: "split", slots: ["thinking", "generating"] })).toBe(
      "Brain - thinking · generating tokens",
    );
  });

  it("labels the spectrum by count", () => {
    expect(resolveBrainActivityLabel({ kind: "spectrum", count: 3 })).toBe(
      "Brain - 3 slots working",
    );
  });

  it("labels a single activity as the state's own sentence", () => {
    expect(resolveBrainActivityLabel({ kind: "single", state: "idle" })).toBe(
      BRAIN_STATE_LABELS.idle,
    );
  });
});
