import type { CommunicationRoom } from "@otto-code/protocol/communications";

/**
 * Merges a polled room fetch into the live room state without clobbering a
 * message the user just sent that has not yet appeared in the provider's own
 * eventually-consistent read (kept, appended after the provider's own
 * ordering; the timeline re-sorts by `sentAt` for display either way).
 */
export function mergeRoomMessages(
  current: CommunicationRoom,
  next: CommunicationRoom,
): CommunicationRoom {
  const nextIds = new Set(next.messages.map((message) => message.messageId));
  const localOnly = current.messages.filter((message) => !nextIds.has(message.messageId));
  return { ...next, messages: [...next.messages, ...localOnly] };
}
