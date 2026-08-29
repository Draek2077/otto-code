import type { StreamItem } from "@/types/stream";

/**
 * A loading compaction is an exclusive maintenance turn. It deliberately does
 * not accept an interrupting prompt: later prompts wait in the composer queue
 * until the compacted context is ready for the next agent turn.
 */
export function isCompactionActive(items: readonly StreamItem[], isTurnActive: boolean): boolean {
  return (
    isTurnActive && items.some((item) => item.kind === "compaction" && item.status === "loading")
  );
}
