import type { StreamItem } from "@/types/stream";

export interface FinishedSegment {
  /** Stable across live-head finalization: group and block survive item-ID changes. */
  key: string;
  /** The visual bubble marked as speaking. */
  groupId: string;
  text: string;
}

/**
 * Speech follows the daemon's turn identity, independently of the visual reveal.
 * A paragraph is finished once the turn moves past it; closing the turn releases
 * its final paragraph. Optimistic prompts do not finish or start a spoken turn.
 */
export function finishedAssistantSegments(input: {
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
  turnId: string | null;
  activeTurnId: string | null;
}): { turnKey: string | null; segments: FinishedSegment[] } {
  if (input.turnId === null) return { turnKey: null, segments: [] };
  const items = [...input.tail, ...input.head].filter(
    (item) => item.turnId === input.turnId && !(item.kind === "user_message" && item.optimistic),
  );
  const last = items.at(-1);
  const growingItemId =
    input.activeTurnId === input.turnId && last?.kind === "assistant_message" ? last.id : undefined;
  const segments: FinishedSegment[] = [];
  for (const item of items) {
    if (item.kind !== "assistant_message" || !item.blockGroupId || item.id === growingItemId)
      continue;
    segments.push({
      key: `${item.blockGroupId}:${item.blockIndex ?? 0}`,
      groupId: item.blockGroupId,
      text: item.text,
    });
  }
  return { turnKey: input.turnId, segments };
}
