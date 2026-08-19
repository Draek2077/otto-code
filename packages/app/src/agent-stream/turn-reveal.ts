import { useEffect, useState } from "react";
import type { StreamItem } from "@/types/stream";
import { isWeb } from "@/constants/platform";
import { getIsAppVisible } from "@/utils/app-visibility";
import { isElectronRuntime } from "@/desktop/host";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";

// TEMP DIAGNOSTIC (2026-08-18): rolling in-memory trace for the tab-switch
// replay report. On desktop it also auto-flushes to
// $OTTO_HOME/reveal-traces/latest.json (see scheduleRevealTraceFlush below),
// so reading it back needs no devtools/console step. On plain web (no desktop
// bridge) it still needs the manual capture: run in the console
//   copy(JSON.stringify(window.__revealTrace, null, 2))
// Capped ring buffer so it never grows unbounded. Remove this once a root
// cause lands.
//
// Dev builds only. This is not cheap enough to ship: the trace is fed from the
// stream view's render body and from the ticker's 32ms tick, and on desktop it
// re-serializes the entire buffer to disk every 15 seconds for the life of the
// session. Metro dead-code-strips the calls when `__DEV__` is false, matching
// the DEBUG_REVEAL gate in use-sidebar-reveal-controller.ts.
//
// Read through `typeof` rather than bound at module scope: this module is
// imported directly by unit tests, which do not define `__DEV__`. Metro still
// substitutes the identifier and strips the branch in release builds.
function revealTraceEnabled(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

const REVEAL_TRACE_LIMIT = 20000;
export function pushRevealTrace(entry: Record<string, unknown>): void {
  if (!revealTraceEnabled() || !isWeb || typeof window === "undefined") return;
  const globalWindow = window as unknown as { __revealTrace?: Record<string, unknown>[] };
  const buffer = (globalWindow.__revealTrace ??= []);
  buffer.push({ t: Date.now(), ...entry });
  if (buffer.length > REVEAL_TRACE_LIMIT) {
    buffer.splice(0, buffer.length - REVEAL_TRACE_LIMIT);
  }
  scheduleRevealTraceFlush();
}

// TEMP DIAGNOSTIC (2026-08-18): periodic best-effort flush of the reveal
// trace buffer to disk, so a fresh session can read the file directly
// instead of asking the user to run a console command mid-task. Runs at most
// once per interval regardless of how often pushRevealTrace is called, and
// skips the write entirely when the buffer hasn't grown since the last flush.
const REVEAL_TRACE_FLUSH_INTERVAL_MS = 15_000;
let revealTraceFlushTimer: ReturnType<typeof setInterval> | null = null;
let revealTraceFlushedLength = 0;

function scheduleRevealTraceFlush(): void {
  if (revealTraceFlushTimer || typeof window === "undefined" || !isElectronRuntime()) return;
  revealTraceFlushTimer = setInterval(() => {
    void flushRevealTraceToDisk();
  }, REVEAL_TRACE_FLUSH_INTERVAL_MS);
}

async function flushRevealTraceToDisk(): Promise<void> {
  const globalWindow = window as unknown as { __revealTrace?: Record<string, unknown>[] };
  const buffer = globalWindow.__revealTrace;
  if (!buffer || buffer.length === 0 || buffer.length === revealTraceFlushedLength) return;
  revealTraceFlushedLength = buffer.length;
  try {
    await invokeDesktopCommand("write_reveal_trace", {
      contents: `${JSON.stringify(buffer, null, 2)}\n`,
    });
  } catch {
    // Best-effort diagnostic flush - never let a write failure surface into
    // the render path. The next interval retries.
  }
}

const REVEAL_TICK_MS = 32;
const MIN_CHARS_PER_TICK = 2;
// Each tick reveals 1/8 of the outstanding backlog (with a floor), so a
// steady stream reveals a few characters at a time and reads as continuous
// typing while bursts type faster.
const BACKLOG_CATCHUP_DIVISOR = 8;
// Typing rate ceiling (~4k chars/s at 32ms ticks). Without it
// the proportional step makes a whole-message burst - Fable's safety-buffered
// stream delivers most of a message at once - converge in ~8 ticks, which
// reads as an instant dump instead of typing.
const MAX_CHARS_PER_TICK = 128;
// Skip-ahead bound: never keep more than ~2s of typing queued. A tab left
// running in the background can accumulate tens of thousands of characters;
// on return the older content snaps in and only the most recent stretch
// types out.
const MAX_PENDING_CHARS = 8000;
// A turn boundary (new user message) normally appears before any assistant
// text exists, so the reveal resets to 0 and the reply types from its first
// character. If a boundary change arrives with a LOT of assistant text
// already present, it is a rebuild (reconnect / canonical replace), not a
// new turn - snap caught-up so replaced history never replays.
const NEW_TURN_SNAP_THRESHOLD_CHARS = 600;

/** Pure step function: how much of the turn should be revealed next tick. */
export function nextRevealLength(current: number, target: number): number {
  if (current >= target) {
    return current;
  }
  let position = current;
  let backlog = target - position;
  if (backlog > MAX_PENDING_CHARS) {
    position = target - MAX_PENDING_CHARS;
    backlog = MAX_PENDING_CHARS;
  }
  const step = Math.min(
    Math.max(MIN_CHARS_PER_TICK, Math.ceil(backlog / BACKLOG_CATCHUP_DIVISOR)),
    MAX_CHARS_PER_TICK,
  );
  return Math.min(target, position + step);
}

/**
 * Don't split a surrogate pair: if the boundary lands between a high and low
 * surrogate, hold the trailing unit back until the next tick.
 */
export function sliceAtSafeBoundary(text: string, end: number): string {
  const code = text.charCodeAt(end - 1);
  const safeEnd = code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
  return text.slice(0, safeEnd);
}

export interface TurnRevealSpan {
  /** Offset of this item's text within the live turn's concatenated text. */
  start: number;
  length: number;
}

export interface LiveTurnReveal {
  /**
   * Identity of the turn: the id of the user message that started it. A key
   * change tells the ticker "this is a different turn" so it can reset.
   */
  turnKey: string;
  totalChars: number;
  /** Per assistant-item spans, in stream order. Empty when not running. */
  spans: ReadonlyMap<string, TurnRevealSpan>;
}

const EMPTY_SPANS: ReadonlyMap<string, TurnRevealSpan> = new Map();

export const EMPTY_TURN_REVEAL: LiveTurnReveal = {
  turnKey: "idle",
  totalChars: 0,
  spans: EMPTY_SPANS,
};

/**
 * Where the running turn starts: the last user message the daemon has echoed
 * back. Optimistic rows are skipped - one appended mid-run (a steer) does not
 * start a turn, and its id is replaced when the canonical row lands, which
 * would read as a turn change.
 */
export function findTurnBoundary(all: readonly StreamItem[]): {
  index: number;
  turnKey: string;
} {
  for (let index = all.length - 1; index >= 0; index -= 1) {
    const item = all[index];
    if (item?.kind === "user_message" && !item.optimistic) {
      return { index, turnKey: item.id };
    }
  }
  return { index: -1, turnKey: "session-start" };
}

/**
 * Map the live turn's assistant text onto one contiguous reveal axis.
 *
 * The reveal must pace ABOVE block promotion: promotion moves completed
 * paragraphs out of the live head item into settled tail items on every
 * assistant event, so any per-item reveal lets whole paragraphs bypass the
 * animation (they pop in fully as new settled items). Spans are recomputed
 * from the current items each flush, and the turn's concatenated text is
 * invariant across promotion, so one position over the whole turn survives
 * every reshape of the underlying items.
 */
export function computeLiveTurnReveal(params: {
  running: boolean;
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
  /**
   * The boundary of the turn that already finished - the caller latches it
   * whenever the agent is idle (see the stream view).
   *
   * Sending a message flips the agent to running while the only row for it is
   * still optimistic, so for a beat the boundary search below lands on the
   * PREVIOUS turn and hands the finished reply's items live spans. That is not
   * cosmetic: consumers read a span as "this is being written right now", so
   * the previous reply re-typed itself on screen and auto-speech read it back
   * the moment you hit send. A turn that has already been settled cannot be
   * the running one - it spans nothing until its own user row arrives.
   */
  settledTurnKey?: string | null;
}): LiveTurnReveal {
  if (!params.running) {
    return EMPTY_TURN_REVEAL;
  }
  const all = [...params.tail, ...params.head];
  const { index: boundaryIndex, turnKey } = findTurnBoundary(all);
  if (params.settledTurnKey !== undefined && params.settledTurnKey === turnKey) {
    return EMPTY_TURN_REVEAL;
  }
  const spans = new Map<string, TurnRevealSpan>();
  let totalChars = 0;
  for (let index = boundaryIndex + 1; index < all.length; index += 1) {
    const item = all[index];
    if (item?.kind !== "assistant_message") {
      continue;
    }
    spans.set(item.id, { start: totalChars, length: item.text.length });
    totalChars += item.text.length;
  }
  return { turnKey, totalChars, spans };
}

/** Budget for one item: how many of its characters are revealed right now. */
export function clampRevealBudget(revealedTotal: number, span: TurnRevealSpan): number {
  return Math.max(0, Math.min(span.length, revealedTotal - span.start));
}

/**
 * The only assistant item the model can still be extending. An action after
 * prose closes that prose bubble even while the turn continues, so the bubble
 * is no longer the growing tail just because it is the latest assistant item.
 */
export function getGrowingAssistantItemId(
  items: readonly StreamItem[],
  reveal: LiveTurnReveal,
): string | undefined {
  const lastItem = items.at(-1);
  return lastItem?.kind === "assistant_message" && reveal.spans.has(lastItem.id)
    ? lastItem.id
    : undefined;
}

/**
 * The paced reveal position for the live turn. Plain external store rather
 * than React state so the 32ms ticks NEVER re-render the stream view - each
 * assistant item subscribes to its own clamped budget via
 * useSyncExternalStore and only the item the reveal boundary is crossing
 * re-renders on a tick.
 */
export class TurnRevealTicker {
  private revealed: number;
  private target: number;
  private turnKey: string;
  private wasVisible = true;
  private pendingReturnSnap = false;
  /**
   * Whether the key currently held in `this.turnKey` was ever observed in a
   * DISABLED state (agent not running) while we held it.
   *
   * This is the discriminator between a GENUINE NEW TURN and a CANONICAL
   * REPLACE re-identification. The two look identical in (turnKey, target)
   * space - both change the key, both can carry a small or a large target -
   * because `turnKey` is the boundary user line's *derived* id, which a
   * canonical timeline replace re-derives (the docs say it: "a canonical
   * timeline replace rebuilds a finished turn's items with freshly derived
   * ids"), and the target depends on where the boundary lands, which during a
   * replace can briefly be an OLDER user line (so the target GROWS to include
   * the older reply's text - the case a target-size heuristic misses).
   *
   * What separates them is the agent's status history. A genuine new turn is
   * always preceded by the previous turn ENDING: the status flips to
   * non-running, the view hands the ticker the stable "idle" key (target 0,
   * enabled false), and the next user row lands under a FRESH key. A canonical
   * replace arrives while the agent is STILL RUNNING - the key changes but we
   * never observed the outgoing key in a disabled state.
   *
   * So: on a key change, if the key we are LEAVING was ever seen disabled,
   * the incoming key is a genuine new turn (we crossed a status boundary) and
   * we reset to 0 so the reply types out. If not, the incoming key is a
   * re-identification of the same logical turn (a canonical replace) and we
   * SNAP to the target, never re-typing.
   */
  private keyWasDisabled = false;
  private readonly isOnScreen: () => boolean;
  private readonly listeners = new Set<() => void>();
  // TEMP DIAGNOSTIC (2026-08-18): traces the tab-switch replay report. Remove
  // once a root cause lands - see .otto/knowledge for the finding this feeds.
  private readonly debugLabel?: string;

  constructor(params: {
    turnKey: string;
    target: number;
    isOnScreen?: () => boolean;
    debugLabel?: string;
  }) {
    this.turnKey = params.turnKey;
    this.target = params.target;
    // Mount caught-up: opening a screen mid-turn never replays history.
    this.revealed = params.target;
    // Injected rather than imported so the ticker stays a pure unit under test.
    this.isOnScreen = params.isOnScreen ?? (() => true);
    // One gate for every trace site below: the console.info calls, the `before`
    // snapshot allocation in update(), and the per-tick trace all hang off this
    // being set, so clearing it here disarms them in release builds no matter
    // what the caller passes.
    this.debugLabel = revealTraceEnabled() ? params.debugLabel : undefined;
    if (this.debugLabel) {
      // eslint-disable-next-line no-console
      console.info(
        `[reveal-trace:${this.debugLabel}] CONSTRUCT key=${this.turnKey} target=${this.target} revealed=${this.revealed}`,
      );
      pushRevealTrace({
        label: this.debugLabel,
        event: "CONSTRUCT",
        key: this.turnKey,
        target: this.target,
        revealed: this.revealed,
      });
    }
  }

  /**
   * Render-phase reconcile (targetRef pattern): keeps the target current and
   * handles turn boundaries. Deliberately does NOT notify listeners - it runs
   * while the owner is already rendering the subscribers with fresh props.
   *
   * `visible` is the per-pane axis, separate from the app-level check in
   * `tick`. A hidden chat pane freezes its stream data (see the stream view),
   * so the target the reveal converged on while you were away is stale, and
   * coming back re-reads the live buffers and jumps the target by everything
   * the agent produced meanwhile. That is why `tick` can never see it. Left
   * paced, the whole backlog types itself out on re-entry: the chat visibly
   * rushes for a couple of seconds before settling on where the turn actually
   * is. Stay caught up while hidden and snap on the way back in, so re-entry
   * shows the settled state and only text arriving after you return types out.
   *
   * `dataSettled` is what makes that snap land on the RIGHT number, and its
   * absence is why the first version of this fix did nothing. The jump does
   * NOT arrive in the same render as the return: the stream view runs its
   * items through `useDeferredValue`, so the first render back still carries
   * the frozen target. Snapping there snaps to the stale value, and the live
   * target lands a render later with the return already consumed - pacing the
   * away backlog exactly as before. So the return is LATCHED and re-snaps on
   * every render until one arrives carrying live data.
   */
  update(params: {
    turnKey: string;
    target: number;
    enabled: boolean;
    visible?: boolean;
    /**
     * Whether `target` was computed from live stream data rather than a
     * deferred (stale) snapshot. Callers with no deferral pipeline omit it.
     */
    dataSettled?: boolean;
  }): void {
    // A caller with no panel context (transcript dialog, tests) is always on.
    const visible = params.visible ?? true;
    const dataSettled = params.dataSettled ?? true;
    const before = this.debugLabel
      ? {
          revealed: this.revealed,
          target: this.target,
          turnKey: this.turnKey,
          wasVisible: this.wasVisible,
          pendingReturnSnap: this.pendingReturnSnap,
          keyWasDisabled: this.keyWasDisabled,
        }
      : undefined;

    if (params.turnKey !== this.turnKey) {
      // Decide by STATUS HISTORY, not target size. If the key we are leaving
      // was ever observed disabled (agent idle), we crossed a real turn
      // boundary - the incoming key is a fresh turn, reset to 0 so the reply
      // types from its first character. If it was never disabled, the key
      // change came from a canonical replace re-deriving ids while the agent
      // was still running - snap to the target so the already-typed text
      // (which may include an OLDER turn's reply, if the boundary briefly
      // landed on an older row) is never re-typed.
      const isFreshTurn = this.keyWasDisabled && params.target <= NEW_TURN_SNAP_THRESHOLD_CHARS;
      this.revealed = isFreshTurn ? 0 : params.target;
      this.keyWasDisabled = false;
      this.turnKey = params.turnKey;
    }
    if (!params.enabled) {
      // The agent went idle under this key: it now stands for a settled turn.
      // Latch it so the next key change reads as a fresh turn.
      this.keyWasDisabled = true;
    }
    this.target = params.target;
    if (visible && !this.wasVisible) {
      this.pendingReturnSnap = true;
    }
    this.wasVisible = visible;
    if (!params.enabled || !visible || this.pendingReturnSnap || this.revealed > params.target) {
      this.revealed = params.target;
    }
    // Hold the latch until the target is trustworthy. Releasing it on a stale
    // render is what let the backlog through.
    if (this.pendingReturnSnap && dataSettled) {
      this.pendingReturnSnap = false;
    }
    if (before && this.debugLabel) {
      // eslint-disable-next-line no-console
      console.info(
        `[reveal-trace:${this.debugLabel}] UPDATE` +
          ` in{key=${params.turnKey} target=${params.target} enabled=${params.enabled} visible=${visible} dataSettled=${dataSettled}}` +
          ` before{revealed=${before.revealed} target=${before.target} key=${before.turnKey} wasVisible=${before.wasVisible} pendingReturnSnap=${before.pendingReturnSnap} keyWasDisabled=${before.keyWasDisabled}}` +
          ` after{revealed=${this.revealed} target=${this.target} key=${this.turnKey} wasVisible=${this.wasVisible} pendingReturnSnap=${this.pendingReturnSnap} keyWasDisabled=${this.keyWasDisabled}}`,
      );
      pushRevealTrace({
        label: this.debugLabel,
        event: "UPDATE",
        in: {
          key: params.turnKey,
          target: params.target,
          enabled: params.enabled,
          visible,
          dataSettled,
        },
        before,
        after: {
          revealed: this.revealed,
          target: this.target,
          key: this.turnKey,
          wasVisible: this.wasVisible,
          pendingReturnSnap: this.pendingReturnSnap,
          keyWasDisabled: this.keyWasDisabled,
        },
      });
    }
  }

  tick = (): void => {
    // Off screen, snap. There is nothing to animate for a hidden tab or a
    // pocketed phone, and pacing there is actively harmful: browsers clamp a
    // background `setInterval` to about 1Hz, so the reveal - not the model -
    // becomes the bottleneck. Everything downstream that waits for a segment to
    // reach full length waits with it, and auto-speech, whose entire point is
    // that you are NOT looking at the screen, goes silent behind a tab switch.
    const next = this.isOnScreen() ? nextRevealLength(this.revealed, this.target) : this.target;
    if (next === this.revealed) {
      return;
    }
    if (this.debugLabel) {
      // eslint-disable-next-line no-console
      console.info(
        `[reveal-trace:${this.debugLabel}] TICK key=${this.turnKey} revealed=${this.revealed}->${next} target=${this.target}`,
      );
      pushRevealTrace({
        label: this.debugLabel,
        event: "TICK",
        key: this.turnKey,
        revealedFrom: this.revealed,
        revealedTo: next,
        target: this.target,
      });
    }
    this.revealed = next;
    for (const listener of this.listeners) {
      listener();
    }
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getRevealed = (): number => this.revealed;
}

/**
 * Keeps a returning transcript on one coherent stream snapshot.
 *
 * React defers the expensive transcript projection, which normally means an
 * update renders the previous stream once before the current one. That is
 * useful while reading an active chat, but not after a hidden app or retained
 * pane returns: the previous snapshot is the entire away-period transcript.
 * Rendering it first makes action groups reshape and text reveal after the
 * chat is visible again. Hold the current snapshot until deferral catches up,
 * then resume normal deferral for future, on-screen events.
 */
export class StreamResumeGate {
  private wasVisible: boolean;
  private pendingFreshSnapshot = false;

  constructor(visible = true) {
    this.wasVisible = visible;
  }

  select<Tail, Head>(params: {
    visible: boolean;
    currentTail: Tail;
    currentHead: Head;
    deferredTail: Tail;
    deferredHead: Head;
  }): { tail: Tail; head: Head; dataSettled: boolean } {
    if (!params.visible) {
      this.wasVisible = false;
      this.pendingFreshSnapshot = true;
      return {
        tail: params.deferredTail,
        head: params.deferredHead,
        dataSettled:
          params.currentTail === params.deferredTail && params.currentHead === params.deferredHead,
      };
    }

    if (!this.wasVisible) {
      this.pendingFreshSnapshot = true;
    }
    this.wasVisible = true;

    const dataSettled =
      params.currentTail === params.deferredTail && params.currentHead === params.deferredHead;
    if (this.pendingFreshSnapshot) {
      if (dataSettled) {
        this.pendingFreshSnapshot = false;
      }
      return { tail: params.currentTail, head: params.currentHead, dataSettled };
    }
    return { tail: params.deferredTail, head: params.deferredHead, dataSettled };
  }
}

export function useTurnRevealTicker(params: {
  turnKey: string;
  target: number;
  enabled: boolean;
  visible?: boolean;
  dataSettled?: boolean;
  // TEMP DIAGNOSTIC (2026-08-18): see TurnRevealTicker.debugLabel.
  debugLabel?: string;
}): TurnRevealTicker {
  const [ticker] = useState(() => new TurnRevealTicker({ ...params, isOnScreen: getIsAppVisible }));
  ticker.update(params);
  // Hidden panes hold no timer at all: `update` keeps them caught up, so a
  // 31Hz interval per backgrounded chat would only ever bail. Every running
  // agent whose pane sits behind another tab was paying for one.
  const paced = params.enabled && (params.visible ?? true);
  useEffect(() => {
    if (!paced) {
      return;
    }
    // Runs for the whole live phase; caught-up ticks bail before notifying,
    // so idle cost is negligible.
    const handle = setInterval(ticker.tick, REVEAL_TICK_MS);
    return () => clearInterval(handle);
  }, [paced, ticker]);
  return ticker;
}
