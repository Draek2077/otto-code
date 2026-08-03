import { useCallback, useSyncExternalStore } from "react";

// Cross-row text registry for assistant bubble groups — a sibling of
// bubble-group-offsets.ts, and it exists for the same structural reason.
//
// A streamed reply is promoted one markdown block at a time into separate
// `assistant_message` rows sharing a `blockGroupId` (see
// types/stream.ts). Those rows butt together visually into a single bubble, so
// what the reader calls "a message" is the GROUP, not the row. The playback
// button lives on the group's last row but has to read the whole group aloud,
// and a row cannot see its siblings — hence a registry: every segment reports
// its text under (groupId, blockIndex), and the button reads them back joined
// in block order.
//
// Text is reported from the store item, never from the typewriter-revealed
// slice, so playback is always full fidelity even if the reveal is mid-flight.
//
// Subscriptions are per group, and the only thing subscribers read — "does this
// group have anything to say" — is kept as a count rather than recomputed. Both
// are for the same reason: the live group re-reports on every reveal tick, and a
// global notification made every mounted bubble in the transcript rejoin its
// whole group's text just to re-derive a boolean that had not changed.

const MAX_TRACKED_GROUPS = 64;

interface BubbleGroup {
  texts: Map<number, string>;
  /**
   * How many of the group's blocks currently hold non-whitespace text. This is
   * `getAssistantBubbleText(groupId).length > 0` without the sort, the trims,
   * and the join, which is all the playback button ever needed.
   */
  nonBlankBlocks: number;
}

const groups = new Map<string, BubbleGroup>();
const listenersByGroup = new Map<string, Set<() => void>>();

function hasVisibleText(text: string): boolean {
  return /\S/.test(text);
}

export function subscribeAssistantBubbleText(groupId: string, listener: () => void): () => void {
  let listeners = listenersByGroup.get(groupId);
  if (!listeners) {
    listeners = new Set();
    listenersByGroup.set(groupId, listeners);
  }
  const bucket = listeners;
  bucket.add(listener);
  return () => {
    bucket.delete(listener);
    // Only drop the bucket if it is still the live one — a resubscribe between
    // these two lines would otherwise lose its listeners.
    if (bucket.size === 0 && listenersByGroup.get(groupId) === bucket) {
      listenersByGroup.delete(groupId);
    }
  };
}

function notify(groupId: string): void {
  const listeners = listenersByGroup.get(groupId);
  if (!listeners) {
    return;
  }
  for (const listener of listeners) {
    listener();
  }
}

export function reportAssistantBubbleText(input: {
  groupId: string;
  blockIndex: number;
  text: string;
}): void {
  let group = groups.get(input.groupId);
  if (!group) {
    group = { texts: new Map(), nonBlankBlocks: 0 };
    groups.set(input.groupId, group);
    while (groups.size > MAX_TRACKED_GROUPS) {
      const oldest = groups.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      groups.delete(oldest);
    }
  }
  const previous = group.texts.get(input.blockIndex);
  if (previous === input.text) {
    return;
  }
  group.texts.set(input.blockIndex, input.text);
  const hadText = previous !== undefined && hasVisibleText(previous);
  const hasText = hasVisibleText(input.text);
  if (hadText !== hasText) {
    group.nonBlankBlocks += hasText ? 1 : -1;
  }
  notify(input.groupId);
}

/**
 * The group's blocks rejoined in block order, blank-line separated — the same
 * shape `splitMarkdownBlocks` took them apart from. Empty string for an unknown
 * group.
 */
export function getAssistantBubbleText(groupId: string): string {
  const group = groups.get(groupId);
  if (!group) {
    return "";
  }
  return [...group.texts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Whether the group holds any readable text, without building it. */
export function getAssistantBubbleHasText(groupId: string): boolean {
  return (groups.get(groupId)?.nonBlankBlocks ?? 0) > 0;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribeNothing(): () => void {
  return () => {};
}

/**
 * Subscribe to a bubble group's full text. Used only to decide whether the
 * playback button has anything to read — the button resolves the text itself on
 * press, so a mid-stream change does not need to re-render it.
 */
export function useAssistantBubbleHasText(groupId: string | undefined): boolean {
  const subscribe = useCallback(
    (listener: () => void) =>
      groupId === undefined ? subscribeNothing() : subscribeAssistantBubbleText(groupId, listener),
    [groupId],
  );
  const getSnapshot = useCallback(
    () => (groupId === undefined ? false : getAssistantBubbleHasText(groupId)),
    [groupId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function clearAssistantBubbleTexts(): void {
  groups.clear();
}
