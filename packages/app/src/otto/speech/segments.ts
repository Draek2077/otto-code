import type { StreamItem } from "@/types/stream";
/** Feed only paragraphs the provider has moved past, then the final paragraph
 * when the identified turn closes. Seed already-finished paragraphs on first
 * observation, including reconnect/history hydration; never narrate history.
 */
export function createSpeechSegments() {
  let watched: string | null = null;
  let seeded = false;
  let latestSeen: string | null = null;
  let handled = new Set<string>();
  function finished(items: readonly StreamItem[], turnId: string, active: string | null) {
    const turn = items.filter((item) => item.turnId === turnId);
    const growing =
      active === turnId && turn.at(-1)?.kind === "assistant_message" ? turn.at(-1) : null;
    const ordinals = new Map<string, number>();
    return turn.flatMap((item) => {
      if (item.kind !== "assistant_message") return [];
      const id = item.messageId ?? item.id;
      const ordinal = ordinals.get(id) ?? 0;
      ordinals.set(id, ordinal + 1);
      if (item === growing || !item.text.trim()) return [];
      return [{ key: JSON.stringify([turnId, id, ordinal]), text: item.text, itemId: item.id }];
    });
  }
  return {
    update(items: readonly StreamItem[], activeTurnId: string | null) {
      const latest = items.findLast((item) => item.turnId)?.turnId ?? null;
      const appendedTurn = latest !== latestSeen;
      latestSeen = latest;
      if (!seeded) {
        seeded = true;
        watched = activeTurnId ?? latest;
        if (watched) {
          handled = new Set(finished(items, watched, activeTurnId).map((segment) => segment.key));
        }
        return [];
      }
      const output: { key: string; text: string; itemId: string }[] = [];
      if (watched) {
        for (const segment of finished(items, watched, activeTurnId)) {
          if (handled.has(segment.key)) continue;
          handled.add(segment.key);
          output.push(segment);
        }
      }
      // The canonical reducer can commit an entire fast turn in one frame.
      // Track the rightmost identified turn as well as liveness: prepending
      // older history leaves that frontier unchanged and must remain silent.
      const next = activeTurnId ?? (appendedTurn ? latest : null);
      if (next && next !== watched) {
        watched = next;
        handled = new Set();
        for (const segment of finished(items, watched, activeTurnId)) {
          handled.add(segment.key);
          output.push(segment);
        }
      }
      return output;
    },
  };
}
