import { describe, expect, it } from "vitest";
import {
  chatOutlineSegmentContains,
  chatOutlineSegmentLabel,
  createActivePromptPublisher,
  MAX_CHAT_OUTLINE_TICKS,
  segmentChatOutlinePrompts,
  shouldAcceptPromptIndexEpoch,
  promptTickMagnification,
  resolveActivePromptSeq,
  OUTLINE_MAGNIFY_RADIUS,
  type ChatOutlinePrompt,
} from "./model";

describe("chat outline prompt index epoch", () => {
  it("accepts only the authoritative timeline epoch", () => {
    expect(shouldAcceptPromptIndexEpoch("epoch-2", "epoch-2")).toBe(true);
    expect(shouldAcceptPromptIndexEpoch("epoch-2", "epoch-1")).toBe(false);
    expect(shouldAcceptPromptIndexEpoch(null, "epoch-1")).toBe(true);
  });
});

function prompt(seq: number): ChatOutlinePrompt {
  return { seq, timestamp: new Date(seq).toISOString(), preview: `prompt ${seq}` };
}

describe("segmentChatOutlinePrompts", () => {
  it("keeps a small outline prompt-for-prompt", () => {
    expect(segmentChatOutlinePrompts([prompt(1), prompt(2), prompt(3)])).toEqual([
      { startIndex: 0, endIndex: 1, startSeq: 1, endSeq: 1, target: prompt(1) },
      { startIndex: 1, endIndex: 2, startSeq: 2, endSeq: 2, target: prompt(2) },
      { startIndex: 2, endIndex: 3, startSeq: 3, endSeq: 3, target: prompt(3) },
    ]);
  });

  it("bounds a long outline while preserving its complete ordered range", () => {
    const prompts = Array.from({ length: 1_000 }, (_, index) => prompt(index + 1));
    const segments = segmentChatOutlinePrompts(prompts);

    expect(segments).toHaveLength(MAX_CHAT_OUTLINE_TICKS);
    expect(segments[0]).toMatchObject({ startIndex: 0, startSeq: 1 });
    expect(segments.at(-1)).toMatchObject({ endIndex: 1_000, endSeq: 1_000 });
    expect(
      segments.every(
        (segment, index) => index === 0 || segment.startIndex === segments[index - 1].endIndex,
      ),
    ).toBe(true);
  });

  it("marks an active prompt in its condensed segment and describes that range", () => {
    const segment = segmentChatOutlinePrompts(
      Array.from({ length: 10 }, (_, index) => prompt(index + 1)),
      3,
    )[1];

    expect(chatOutlineSegmentContains(segment, 5)).toBe(true);
    expect(chatOutlineSegmentContains(segment, 1)).toBe(false);
    expect(chatOutlineSegmentLabel(segment, 10)).toBe("Prompts 4 through 6 of 10: prompt 5");
  });
});

describe("promptTickMagnification", () => {
  it("peaks under the pointer and decays to nothing at the radius", () => {
    expect(promptTickMagnification(0)).toBe(1);
    expect(promptTickMagnification(OUTLINE_MAGNIFY_RADIUS)).toBe(0);
    expect(promptTickMagnification(OUTLINE_MAGNIFY_RADIUS + 10)).toBe(0);
  });

  it("falls off monotonically and symmetrically around the pointer", () => {
    const above = [0, 1, 2, 3].map((distance) => promptTickMagnification(distance));
    const below = [0, -1, -2, -3].map((distance) => promptTickMagnification(distance));

    expect(above).toEqual(below);
    expect(above).toEqual([...above].sort((left, right) => right - left));
  });
});

describe("resolveActivePromptSeq", () => {
  const prompts = [prompt(2), prompt(9), prompt(20)];

  it("marks the prompt whose turn the reading position sits in", () => {
    expect(resolveActivePromptSeq(prompts, 9)).toBe(9);
    expect(resolveActivePromptSeq(prompts, 14)).toBe(9);
    expect(resolveActivePromptSeq(prompts, 20)).toBe(20);
    expect(resolveActivePromptSeq(prompts, 99)).toBe(20);
  });

  it("marks nothing above the first prompt or without a reading position", () => {
    expect(resolveActivePromptSeq(prompts, 1)).toBeNull();
    expect(resolveActivePromptSeq(prompts, null)).toBeNull();
    expect(resolveActivePromptSeq([], 42)).toBeNull();
  });
});

describe("createActivePromptPublisher", () => {
  it("notifies subscribers only when the active prompt changes", () => {
    const publisher = createActivePromptPublisher();
    let notifications = 0;
    const unsubscribe = publisher.subscribe(() => {
      notifications += 1;
    });

    publisher.publish(9);
    publisher.publish(9);
    publisher.publish(20);
    unsubscribe();
    publisher.publish(null);

    expect(notifications).toBe(2);
    expect(publisher.getActiveSeq()).toBeNull();
  });
});
