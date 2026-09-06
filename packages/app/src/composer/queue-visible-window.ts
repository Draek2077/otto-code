export const VISIBLE_QUEUED_MESSAGE_LIMIT = 5;

/**
 * Keeps the Composer's queue chrome bounded without removing items from the
 * underlying queue. Removing the head makes the following entry visible.
 */
export function visibleQueuedMessageWindow<T>(items: readonly T[]): readonly T[] {
  return items.slice(0, VISIBLE_QUEUED_MESSAGE_LIMIT);
}
