import type { AgentTimelinePromptIndexPayload } from "@otto-code/client/internal/daemon-client";

export type ChatOutlinePrompt = AgentTimelinePromptIndexPayload["prompts"][number];

/**
 * The rail is a positional overview, not a second transcript. Keeping this bounded is
 * load-bearing: each tick owns a focus target, pointer handler, and dynamic style.
 */
export const MAX_CHAT_OUTLINE_TICKS = 96;

export interface ChatOutlineSegment {
  startIndex: number;
  endIndex: number;
  startSeq: number;
  endSeq: number;
  target: ChatOutlinePrompt;
}

/**
 * Groups a long prompt index into evenly distributed, contiguous rail segments. A segment
 * targets its middle prompt so a click remains useful even when several prompts share a tick.
 */
export function segmentChatOutlinePrompts(
  prompts: readonly ChatOutlinePrompt[],
  maxTicks = MAX_CHAT_OUTLINE_TICKS,
): ChatOutlineSegment[] {
  if (prompts.length === 0 || maxTicks < 1) return [];

  const segmentCount = Math.min(prompts.length, maxTicks);
  return Array.from({ length: segmentCount }, (_, index) => {
    const startIndex = Math.floor((index * prompts.length) / segmentCount);
    const endIndex = Math.floor(((index + 1) * prompts.length) / segmentCount);
    const targetIndex = Math.floor((startIndex + endIndex - 1) / 2);
    return {
      startIndex,
      endIndex,
      startSeq: prompts[startIndex].seq,
      endSeq: prompts[endIndex - 1].seq,
      target: prompts[targetIndex],
    };
  });
}

export function chatOutlineSegmentContains(
  segment: ChatOutlineSegment,
  seq: number | null,
): boolean {
  return seq !== null && seq >= segment.startSeq && seq <= segment.endSeq;
}

export function chatOutlineSegmentLabel(segment: ChatOutlineSegment, totalPrompts: number): string {
  const start = segment.startIndex + 1;
  const end = segment.endIndex;
  const range = start === end ? `${start}` : `${start} through ${end}`;
  return `Prompts ${range} of ${totalPrompts}: ${segment.target.preview}`;
}

export function shouldAcceptPromptIndexEpoch(
  timelineEpoch: string | null,
  indexEpoch: string,
): boolean {
  return timelineEpoch === null || timelineEpoch === indexEpoch;
}

/**
 * Slots further than this from the pointer keep their resting size, so a long rail
 * magnifies a local band instead of swelling the whole column.
 */
export const OUTLINE_MAGNIFY_RADIUS = 3;

/**
 * Dock-style falloff: 1 under the pointer, easing to 0 at the radius. The raised cosine
 * has no corner at either end, so sweeping the rail reads as one bulge travelling with
 * the pointer rather than a band switching on and off.
 */
export function promptTickMagnification(slotDistance: number): number {
  const distance = Math.abs(slotDistance);
  if (!Number.isFinite(distance) || distance >= OUTLINE_MAGNIFY_RADIUS) {
    return 0;
  }
  return (1 + Math.cos((Math.PI * distance) / OUTLINE_MAGNIFY_RADIUS)) / 2;
}

/**
 * The prompt whose turn the reader is inside: the last indexed prompt at or before the
 * timeline position under the top of the viewport. It reads the complete daemon index,
 * so a prompt outside the loaded window still lights up while its turn is on screen.
 */
export function resolveActivePromptSeq(
  prompts: readonly ChatOutlinePrompt[],
  anchorSeq: number | null,
): number | null {
  if (anchorSeq === null) {
    return null;
  }
  let activeSeq: number | null = null;
  for (const prompt of prompts) {
    if (prompt.seq > anchorSeq) {
      break;
    }
    activeSeq = prompt.seq;
  }
  return activeSeq;
}

export interface ActivePromptSource {
  subscribe: (listener: () => void) => () => void;
  getActiveSeq: () => number | null;
}

export interface ActivePromptPublisher extends ActivePromptSource {
  publish: (seq: number | null) => void;
}

/**
 * The transcript reports its reading position on every scroll frame, far more often than
 * it re-renders. Keeping the active prompt outside React lets the rail subscribe to it
 * without dragging the transcript through a render on each frame.
 */
export function createActivePromptPublisher(): ActivePromptPublisher {
  const listeners = new Set<() => void>();
  let activeSeq: number | null = null;
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getActiveSeq: () => activeSeq,
    publish(seq) {
      if (seq === activeSeq) {
        return;
      }
      activeSeq = seq;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
