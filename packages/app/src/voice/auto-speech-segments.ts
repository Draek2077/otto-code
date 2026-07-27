// Which assistant segments the model has FINISHED, straight from the stream
// buffers — the pure half of auto-speech's producer (see auto-speech-source.tsx
// for who calls it and why it does not live on the message row).
//
// "Finished" is one rule: every assistant segment of the CURRENT turn except the
// one the model is still appending to. Blocks are promoted out of the live item
// as they complete, so this yields a reply paragraph by paragraph rather than
// all at once when the turn ends — and when the turn does end, the last
// paragraph becomes finished with it.
//
// Scoped to the current turn, never the whole buffer, and the turn's key comes
// back with the segments so the caller can tell one turn from the next. That is
// what keeps a bulk timeline arrival — opening a chat, a reconnect, a history
// page — from looking like a hundred replies that just finished.
import {
  computeLiveTurnReveal,
  findTurnBoundary,
  type LiveTurnReveal,
} from "@/agent-stream/turn-reveal";
import type { StreamItem } from "@/types/stream";

export interface FinishedSegment {
  /**
   * Stable identity across the head→tail flush. The stream item's `id` is
   * rewritten when the live head is finalized (`<group>:head` becomes
   * `<group>:block:<n>`), so it cannot be the key; the (group, block) pair is
   * what that rewrite leaves alone.
   */
  key: string;
  /** The visual bubble — what the UI marks as speaking. */
  groupId: string;
  text: string;
}

function segmentOf(item: StreamItem): FinishedSegment | null {
  if (item.kind !== "assistant_message" || !item.blockGroupId) {
    return null;
  }
  return {
    key: `${item.blockGroupId}:${item.blockIndex ?? 0}`,
    groupId: item.blockGroupId,
    text: item.text,
  };
}

/** The growing end of the live turn — the last item the reveal spans cover. */
function growingTailItemId(reveal: LiveTurnReveal): string | undefined {
  let last: string | undefined;
  for (const itemId of reveal.spans.keys()) {
    last = itemId;
  }
  return last;
}

export function finishedAssistantSegments(input: {
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
  running: boolean;
  /**
   * The turn that already finished, latched by the caller while the agent is
   * idle — pass back what this function returned last time.
   *
   * Sending a message flips the agent to running a beat before the daemon echoes
   * the user row back, and for that beat the turn search lands on the PREVIOUS
   * reply and hands it live spans. Without the latch its last paragraph would
   * look unfinished again the moment you hit send. See computeLiveTurnReveal.
   */
  settledTurnKey: string | null;
}): { turnKey: string; segments: FinishedSegment[]; settledTurnKey: string | null } {
  const all = [...input.tail, ...input.head];
  const boundary = findTurnBoundary(all);
  const settledTurnKey = input.running ? input.settledTurnKey : boundary.turnKey;
  const reveal = computeLiveTurnReveal({
    running: input.running,
    tail: input.tail,
    head: input.head,
    settledTurnKey,
  });
  const growingTail = growingTailItemId(reveal);

  const segments: FinishedSegment[] = [];
  for (let index = boundary.index + 1; index < all.length; index += 1) {
    const item = all[index];
    if (!item || item.id === growingTail) {
      continue;
    }
    const segment = segmentOf(item);
    if (segment) {
      segments.push(segment);
    }
  }
  return { turnKey: boundary.turnKey, segments, settledTurnKey };
}
