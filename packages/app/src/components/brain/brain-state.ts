/**
 * What the Brain rail button is showing, and how it should look showing it.
 *
 * The button on the bottom-left rail is the only always-visible surface the
 * local AI host has, so it carries the whole state machine: liveness, the work
 * in flight, and the long-running ops that own the host for minutes at a time.
 *
 * Two rules hold this together:
 *
 * 1. **A state is only ever shown when a signal for it exists.** Several states
 *    below are declared before the brain can report them (see the signal column
 *    in `docs/brain-console.md`). `deriveBrainState` simply never returns those
 *    until the field lands, and the visual layer needs no change when it does.
 *    Guessing - animating "thinking" because a request is open, say - makes the
 *    icon a liar, and an icon that lies is worse than a static one.
 *
 * 2. **The button always reads as the brain.** Every state draws the same
 *    circuit brain, so "where is the Brain page" never moves on the rail; tint
 *    and motion carry most of the difference. A state that has to be told apart
 *    at a glance either swaps to another glyph in the same family or takes a
 *    mark in a gap bitten out of the brain, which is how the family builds its
 *    own variants.
 */

/** Every state the rail button can be in, grouped by how it is shown. */
export type BrainState =
  // Lifecycle: a flat tint, no motion.
  | "off"
  | "unreachable"
  | "idle"
  | "degraded"
  | "error"
  // Work in flight: the gradient sweeps and the glyph glows.
  | "loading"
  | "unloading"
  | "queued"
  | "prefill"
  | "thinking"
  | "generating"
  | "downloading"
  | "scanning"
  // Long-running ops: amber, same motion rig, own glyph where the family has one.
  | "calibrating"
  | "sweeping"
  | "benchmarking";

/**
 * The tooltip and accessibility text for each state. Every state - idle
 * included - uses its own sentence, so the rail always reads as
 * "Brain - <state>" and never drops the "Brain" identity.
 */
export const BRAIN_STATE_LABELS: Record<BrainState, string> = {
  off: "Brain - off",
  unreachable: "Brain - unreachable",
  idle: "Brain - idle",
  degraded: "Brain - ready, with a warning",
  error: "Brain - failed",
  loading: "Brain - loading model",
  unloading: "Brain - unloading model",
  queued: "Brain - queued",
  prefill: "Brain - processing tokens",
  thinking: "Brain - thinking",
  generating: "Brain - generating tokens",
  downloading: "Brain - downloading model",
  scanning: "Brain - scanning models",
  calibrating: "Brain - calibrating",
  sweeping: "Brain - running a sweep",
  benchmarking: "Brain - benchmarking",
};

export const BRAIN_DISABLED_LABEL = "Brain - Disabled";

export interface BrainRailPresentation {
  state: BrainState;
  label: string | null;
  disabled: boolean;
}

/**
 * Applies the daemon's explicit enablement setting to the rail's otherwise
 * live status presentation. A disabled Brain is intentionally distinct from a
 * stopped or unavailable one: it stays grey and tells the user where to enable
 * it, even if a stale status response still says the host is healthy.
 */
export function resolveBrainRailPresentation(
  state: BrainState,
  enabled: boolean | undefined,
): BrainRailPresentation {
  if (enabled === false) {
    return { state: "off", label: BRAIN_DISABLED_LABEL, disabled: true };
  }
  return { state, label: null, disabled: false };
}

/**
 * The one wording rule every Brain button shares (sidebar footer, settings
 * footer, workspace title bar): the button always carries the state's own
 * sentence - "Brain - idle" when it is merely idle, "Brain - generating tokens"
 * when it is working - so every state reads the same way and the tooltip never
 * drops the "Brain" identity.
 */
export function resolveBrainRailLabel(presentation: BrainRailPresentation): string {
  if (presentation.label) {
    return presentation.label;
  }
  return BRAIN_STATE_LABELS[presentation.state];
}

/**
 * Which glyph the state draws, resolved to markup by `brain-icon-glyphs.ts`.
 *
 * Five of these are the `network_intelligence` family: the same circuit-brain
 * silhouette, four of them with a mark worked into it. That is why the family
 * was picked over the plain `neurology` brain - a state that needs its own
 * glyph gets one that is unmistakably the same object, and every state that
 * does not need one is carried by tint and motion instead.
 *
 * The two ops the family has no variant for keep this base glyph and take a
 * `BrainBadge` instead.
 */
export type BrainGlyph = "brain" | "error" | "download" | "scan" | "benchmark";

/**
 * A mark sitting in a round gap bitten out of the base brain's lower right, for
 * the two ops the family ships no variant for.
 *
 * Composed rather than swapped so the button still reads as the brain, and built
 * exactly the way the family builds its own badges: `network_intelligence_history`
 * and `_update` put their clock and arrow in the same bite. Both marks are round
 * and **filled**, which is what makes them sit in a circular gap without a seam
 * and match the family's solid weight.
 */
export type BrainBadge = "calibrate" | "sweep";

/**
 * How the gradient travels across the glyph. Direction is the differentiator
 * that survives being 24px wide: colour alone is too subtle to read at rail
 * size, so tokens coming in and tokens going out travel opposite ways.
 */
export type BrainMotion =
  | "left-to-right"
  | "right-to-left"
  | "bottom-to-top"
  | "top-to-bottom"
  | "orbit"
  | "pulse";

export interface BrainStateVisual {
  glyph: BrainGlyph;
  /** A mark in a gap bitten out of the glyph. Null for states with their own glyph. */
  badge: BrainBadge | null;
  /**
   * The flat tint, and the base of the sweep gradient. A key on `theme.colors`
   * rather than a literal so every tint follows the active theme.
   */
  tone:
    | "foregroundMuted"
    | "statusSuccess"
    | "statusDanger"
    | "statusWarning"
    | "statusWarningMuted"
    | "statusInfo"
    | "statusMerged"
    | "statusOnline";
  /** Null for the flat lifecycle tints - those must not move. */
  motion: BrainMotion | null;
  /**
   * The bright middle stop of the sweep. A literal, not a theme key: the peak is
   * the one part of the effect that should read the same in every theme, and the
   * palettes have no token this vivid.
   */
  peak: string | null;
  /** One full traversal, in milliseconds. */
  durationMs: number;
  /** Strength of the glow behind the glyph, 0 to 1. */
  glow: number;
}

/**
 * The visual for every state.
 *
 * Durations encode how the work actually feels: token motion is fast because it
 * is fast, model loads are slow because they take tens of seconds and a quick
 * sweep would imply the machine is nearly done when it is not.
 */
export const BRAIN_STATE_VISUALS: Record<BrainState, BrainStateVisual> = {
  off: {
    glyph: "brain",
    badge: null,
    tone: "foregroundMuted",
    motion: null,
    peak: null,
    durationMs: 0,
    glow: 0,
  },
  unreachable: {
    glyph: "brain",
    badge: null,
    tone: "statusWarningMuted",
    motion: null,
    peak: null,
    durationMs: 0,
    glow: 0,
  },
  // Idle is present and ready, not working. A lighter gray, deliberately one
  // step away from `off` (foregroundMuted) so "alive but resting" and
  // "unavailable" do not share a color. Freed from green so `generating` can
  // own it.
  idle: {
    glyph: "brain",
    badge: null,
    tone: "statusOnline",
    motion: null,
    peak: null,
    durationMs: 0,
    glow: 0.2,
  },
  degraded: {
    glyph: "brain",
    badge: null,
    tone: "statusWarning",
    motion: null,
    peak: null,
    durationMs: 0,
    glow: 0.2,
  },
  // The one lifecycle state with its own glyph: the family ships a brain with a
  // warning worked into it, which says more at a glance than red alone.
  error: {
    glyph: "error",
    badge: null,
    tone: "statusDanger",
    motion: null,
    peak: null,
    durationMs: 0,
    glow: 0.3,
  },

  // A load fills the glyph from the bottom like a tank; the unload drains it the
  // other way. Same colour on purpose - the direction is the whole message.
  loading: {
    glyph: "brain",
    badge: null,
    tone: "statusWarning",
    motion: "bottom-to-top",
    peak: "#fbbf24",
    durationMs: 1800,
    glow: 0.55,
  },
  unloading: {
    glyph: "brain",
    badge: null,
    tone: "statusWarning",
    motion: "top-to-bottom",
    peak: "#fbbf24",
    durationMs: 1800,
    glow: 0.4,
  },
  // Queued is work that is not moving yet, so nothing travels - it breathes.
  queued: {
    glyph: "brain",
    badge: null,
    tone: "foregroundMuted",
    motion: "pulse",
    peak: null,
    durationMs: 2200,
    glow: 0.25,
  },
  // Tokens in: left to right, cyan. Tokens out: right to left, green.
  // The peak is the bright middle of the sweep band - pushed as far up the
  // cyan scale as it can go without washing out, so the incoming scan reads at
  // rail size.
  prefill: {
    glyph: "brain",
    badge: null,
    tone: "statusInfo",
    motion: "left-to-right",
    peak: "#a5f3fc", // cyan-200 - the brightest cyan that still reads as cyan
    durationMs: 900,
    glow: 0.6,
  },
  // Green for tokens going out, so it is not confused with `thinking`, which
  // owns the purple/violet family.
  generating: {
    glyph: "brain",
    badge: null,
    tone: "statusSuccess",
    motion: "right-to-left",
    peak: "#86efac", // green-300 - bright sweep over the green base
    durationMs: 750,
    glow: 0.7,
  },
  // Thinking is the one busy state with no throughput to depict, so the glow
  // orbits instead of the gradient travelling: motion without direction.
  thinking: {
    glyph: "brain",
    badge: null,
    tone: "statusMerged",
    motion: "orbit",
    peak: "#e879f9",
    durationMs: 2600,
    glow: 0.75,
  },
  downloading: {
    glyph: "download",
    badge: null,
    tone: "statusInfo",
    motion: "bottom-to-top",
    peak: "#38bdf8",
    durationMs: 1400,
    glow: 0.5,
  },
  scanning: {
    glyph: "scan",
    badge: null,
    tone: "statusInfo",
    motion: "left-to-right",
    peak: "#7dd3fc",
    durationMs: 1100,
    glow: 0.4,
  },

  // The three ops share one amber look and differ only by mark, because from the
  // rail they make the same claim: a long job owns the host and it is not going
  // to answer a prompt promptly. Benchmark has a family variant; calibrate and
  // sweep do not, so they carry a mark in a gap bitten out of the brain.
  calibrating: {
    glyph: "brain",
    badge: "calibrate",
    tone: "statusWarning",
    motion: "orbit",
    peak: "#fb923c",
    durationMs: 2400,
    glow: 0.6,
  },
  sweeping: {
    glyph: "brain",
    badge: "sweep",
    tone: "statusWarning",
    motion: "left-to-right",
    peak: "#fb923c",
    durationMs: 1200,
    glow: 0.6,
  },
  benchmarking: {
    glyph: "benchmark",
    badge: null,
    tone: "statusWarning",
    motion: "bottom-to-top",
    peak: "#fb923c",
    durationMs: 1600,
    glow: 0.6,
  },
};

export function isBusyBrainState(state: BrainState): boolean {
  return BRAIN_STATE_VISUALS[state].motion !== null;
}

/**
 * The subset of the host status this derivation reads.
 *
 * Declared structurally rather than importing `BrainHostStatus` so the rail can
 * be unit-tested without a protocol fixture, and so the fields that do not exist
 * on the wire yet are visibly optional at the one place that consumes them.
 */
export interface BrainStateInput {
  /** Whether the daemon has a brain configured and running at all. */
  running?: boolean | null;
  /** Whether the daemon could reach the brain on its last probe. */
  reachable?: boolean | null;
  /** The supervisor's own state: stopped | starting | ready | failed | stopping. */
  state?: string | null;
  lastError?: string | null;
  /** Jobs the scheduler is holding because no slot is free, or a swap is mid-flight. */
  queued?: number | null;
  /** Per-phase slot occupancy, split out of llama-server's `/slots`. */
  slots?: { prefill?: number | null; decode?: number | null } | null;
  /** Whether any live slot is inside a reasoning block. */
  reasoning?: boolean | null;
  /** Exact aggregate proxy stages from host API v2. */
  inference?: {
    processing?: number | null;
    thinking?: number | null;
    generating?: number | null;
  } | null;
  /** A long-running op that owns the host. */
  activity?: { kind?: string | null } | null;
}

/**
 * The long-running ops, keyed by the `activity.kind` the brain reports. A lookup
 * rather than a switch so an op the client has never heard of falls through to
 * the ordinary busy signals instead of being drawn as something it is not.
 */
const ACTIVITY_STATES: Record<string, BrainState | undefined> = {
  calibrate: "calibrating",
  sweep: "sweeping",
  benchmark: "benchmarking",
  download: "downloading",
  scan: "scanning",
};

/**
 * Collapse the host status into the one state the rail shows.
 *
 * The precedence is the design. Two orderings are load-bearing:
 *
 * - **A long-running op outranks every busy state.** A benchmark loads and
 *   unloads models and runs completions through them; deriving from the raw
 *   signals would flicker the rail between loading, prefill and generating for
 *   the whole run. While an op owns the host, the op is the answer.
 * - **`degraded` is checked last.** A brain with a stale `lastError` that is
 *   nonetheless serving tokens should read as working, not as broken; the
 *   warning tint only surfaces once it is otherwise idle.
 */
export function deriveBrainState(input: BrainStateInput | null | undefined): BrainState {
  if (!input) {
    return "off";
  }

  const lifecycle = deriveLifecycleState(input);
  if (lifecycle) {
    return lifecycle;
  }

  // An op outranks the model loads and completions it causes. Below the
  // lifecycle checks, because a brain that is not answering has no activity to
  // report in the first place.
  const fromActivity = ACTIVITY_STATES[input.activity?.kind ?? ""];
  if (fromActivity) {
    return fromActivity;
  }

  // The supervisor's own transitions, as opposed to the daemon-level ones
  // resolved above: this is a model moving in or out of VRAM on a brain that is
  // otherwise up and answering.
  if (input.state === "starting") {
    return "loading";
  }
  if (input.state === "stopping") {
    return "unloading";
  }

  const busy = deriveInferenceState(input);
  if (busy) {
    return busy;
  }

  if (input.lastError) {
    return "degraded";
  }
  return "idle";
}

/**
 * The liveness half: is this brain there at all, and can we see it?
 *
 * Returns null when the brain is up and answering, which is when the rest of the
 * derivation becomes meaningful. Split out because `state` has to be read before
 * `running` here - the daemon reports `running: false` for three different
 * things (never configured, deliberately stopped, and alive but not bound yet)
 * and only `state` tells them apart.
 */
function deriveLifecycleState(input: BrainStateInput): BrainState | null {
  if (input.state === "unreachable") {
    return "unreachable";
  }
  if (input.state === "unconfigured" || input.state === "stopped") {
    return "off";
  }
  if (input.state === "failed") {
    return "error";
  }
  // The brain's own process coming up, distinguished from the supervisor moving
  // a model into VRAM by `running`: the daemon only reports false while its
  // child exists but the host API has not answered yet.
  if (input.state === "starting" && input.running === false) {
    return "loading";
  }
  if (input.reachable === false) {
    return "unreachable";
  }
  if (input.running === false) {
    return "off";
  }
  return null;
}

/**
 * The busy half of the state: what the loaded model is doing right now, or
 * null when it is doing nothing. Split out of `deriveBrainState` because these
 * are the states that depend on signals the brain only recently grew, and they
 * are the ones most likely to gain siblings.
 *
 * **The rail reads the same signals the Overview's slot rows do.** The panel's
 * rows show each slot's engine phase from llama-server's `/slots`, so the rail
 * derives from that same phase split (plus the `reasoning` flag, which is the
 * one "thinking" signal that is genuinely per-slot: the proxy has seen a
 * reasoning delta on the stream a slot is serving). The request-level
 * `inference` counts are deliberately NOT consulted here, even though they
 * update before the next `/slots` sample: they count requests, not slots, and
 * "thinking" in particular cannot be expressed per slot at all. Preferring
 * them made the rail say "thinking" while the panel's own rows said "Decoding"
 * - the icon contradicting the page it navigates to. The cost is a sub-second
 * lag at request dispatch (the rail moves with the first `/slots` sample
 * instead of at proxy dispatch); once a request-to-slot join exists, the
 * request stages can come back in here without lying.
 */
function deriveInferenceState(input: BrainStateInput): BrainState | null {
  // Reasoning outranks decode: a model emitting reasoning tokens is decoding
  // too, and "thinking" is the more useful of the two claims.
  if (input.reasoning) {
    return "thinking";
  }
  if ((input.slots?.prefill ?? 0) > 0) {
    return "prefill";
  }
  if ((input.slots?.decode ?? 0) > 0) {
    return "generating";
  }
  if ((input.queued ?? 0) > 0) {
    return "queued";
  }
  return null;
}
