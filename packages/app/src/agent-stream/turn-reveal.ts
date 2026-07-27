import { useEffect, useState } from "react";
import type { StreamItem } from "@/types/stream";
import { getIsAppInForeground } from "@/utils/app-visibility";

const REVEAL_TICK_MS = 32;
const MIN_CHARS_PER_TICK = 2;
// Each tick reveals 1/8 of the outstanding backlog (with a floor), so a
// steady stream reveals a few characters at a time and reads as continuous
// typing while bursts type faster.
const BACKLOG_CATCHUP_DIVISOR = 8;
// Typing rate ceiling (~4k chars/s at 32ms ticks). Without it the
// proportional step makes a whole-message burst — Fable's safety-buffered
// stream delivers most of a message at once — converge in ~8 ticks, which
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
// new turn — snap caught-up so replaced history never replays.
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
 * back. Optimistic rows are skipped — one appended mid-run (a steer) does not
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
   * The boundary of the turn that already finished — the caller latches it
   * whenever the agent is idle (see the stream view).
   *
   * Sending a message flips the agent to running while the only row for it is
   * still optimistic, so for a beat the boundary search below lands on the
   * PREVIOUS turn and hands the finished reply's items live spans. That is not
   * cosmetic: consumers read a span as "this is being written right now", so
   * the previous reply re-typed itself on screen and auto-speech read it back
   * the moment you hit send. A turn that has already been settled cannot be
   * the running one — it spans nothing until its own user row arrives.
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
 * The paced reveal position for the live turn. Plain external store rather
 * than React state so the 32ms ticks NEVER re-render the stream view — each
 * assistant item subscribes to its own clamped budget via
 * useSyncExternalStore and only the item the reveal boundary is crossing
 * re-renders on a tick.
 */
export class TurnRevealTicker {
  private revealed: number;
  private target: number;
  private turnKey: string;
  private readonly isOnScreen: () => boolean;
  private readonly listeners = new Set<() => void>();

  constructor(params: { turnKey: string; target: number; isOnScreen?: () => boolean }) {
    this.turnKey = params.turnKey;
    this.target = params.target;
    // Mount caught-up: opening a screen mid-turn never replays history.
    this.revealed = params.target;
    // Injected rather than imported so the ticker stays a pure unit under test.
    this.isOnScreen = params.isOnScreen ?? (() => true);
  }

  /**
   * Render-phase reconcile (targetRef pattern): keeps the target current and
   * handles turn boundaries. Deliberately does NOT notify listeners — it runs
   * while the owner is already rendering the subscribers with fresh props.
   */
  update(params: { turnKey: string; target: number; enabled: boolean }): void {
    if (params.turnKey !== this.turnKey) {
      this.turnKey = params.turnKey;
      this.revealed = params.target <= NEW_TURN_SNAP_THRESHOLD_CHARS ? 0 : params.target;
    }
    this.target = params.target;
    if (!params.enabled || this.revealed > params.target) {
      this.revealed = params.target;
    }
  }

  tick = (): void => {
    // Off screen, snap. There is nothing to animate for a hidden tab or a
    // pocketed phone, and pacing there is actively harmful: browsers clamp a
    // background `setInterval` to about 1Hz, so the reveal — not the model —
    // becomes the bottleneck. Everything downstream that waits for a segment to
    // reach full length waits with it, and auto-speech, whose entire point is
    // that you are NOT looking at the screen, goes silent behind a tab switch.
    const next = this.isOnScreen() ? nextRevealLength(this.revealed, this.target) : this.target;
    if (next === this.revealed) {
      return;
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

export function useTurnRevealTicker(params: {
  turnKey: string;
  target: number;
  enabled: boolean;
}): TurnRevealTicker {
  const [ticker] = useState(
    () => new TurnRevealTicker({ ...params, isOnScreen: getIsAppInForeground }),
  );
  ticker.update(params);
  useEffect(() => {
    if (!params.enabled) {
      return;
    }
    // Runs for the whole live phase; caught-up ticks bail before notifying,
    // so idle cost is negligible.
    const handle = setInterval(ticker.tick, REVEAL_TICK_MS);
    return () => clearInterval(handle);
  }, [params.enabled, ticker]);
  return ticker;
}
