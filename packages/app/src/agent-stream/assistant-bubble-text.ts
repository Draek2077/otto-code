import { useSyncExternalStore } from "react";

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

const MAX_TRACKED_GROUPS = 64;

const groupTexts = new Map<string, Map<number, string>>();
const listeners = new Set<() => void>();

export function subscribeAssistantBubbleText(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function reportAssistantBubbleText(input: {
  groupId: string;
  blockIndex: number;
  text: string;
}): void {
  let texts = groupTexts.get(input.groupId);
  if (!texts) {
    texts = new Map();
    groupTexts.set(input.groupId, texts);
    while (groupTexts.size > MAX_TRACKED_GROUPS) {
      const oldest = groupTexts.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      groupTexts.delete(oldest);
    }
  }
  if (texts.get(input.blockIndex) === input.text) {
    return;
  }
  texts.set(input.blockIndex, input.text);
  notify();
}

/**
 * The group's blocks rejoined in block order, blank-line separated — the same
 * shape `splitMarkdownBlocks` took them apart from. Empty string for an unknown
 * group.
 */
export function getAssistantBubbleText(groupId: string): string {
  const texts = groupTexts.get(groupId);
  if (!texts) {
    return "";
  }
  return [...texts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Subscribe to a bubble group's full text. Used only to decide whether the
 * playback button has anything to read — the button resolves the text itself on
 * press, so a mid-stream change does not need to re-render it.
 */
export function useAssistantBubbleHasText(groupId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribeAssistantBubbleText,
    () => (groupId === undefined ? false : getAssistantBubbleText(groupId).length > 0),
    () => false,
  );
}

export function clearAssistantBubbleTexts(): void {
  groupTexts.clear();
}
