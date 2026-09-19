/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { Buffer } from "buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioEngineCallbacks } from "@/voice/audio-engine-types";
import { useDictationAudioSource } from "./use-dictation-audio-source.native";
import { useDictation } from "./use-dictation";
import { DictationStreamSender } from "@/dictation/dictation-stream-sender";

vi.mock("@/hooks/use-dictation-audio-source", () => import("./use-dictation-audio-source.native"));

const audio = vi.hoisted(() => ({
  callbacks: null as AudioEngineCallbacks | null,
  initialize: vi.fn(async () => {}),
  startCapture: vi.fn(async () => {}),
  stopCapture: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
}));

vi.mock("@/voice/audio-engine", () => ({
  createAudioEngine: (callbacks: AudioEngineCallbacks) => {
    audio.callbacks = callbacks;
    return audio;
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("native dictation audio delivery", () => {
  it("batches Android microphone frames below the relay limit and preserves the final tail", async () => {
    const onPcmSegment = vi.fn();
    const { result } = renderHook(() => useDictationAudioSource({ onPcmSegment }));
    await act(() => result.current.start());

    // Android reads up to 1024 bytes per event: over 300 messages per ten seconds
    // if forwarded individually, exceeding the relay's 200-message allowance.
    const pcm = Buffer.from(Array.from({ length: 320_010 }, (_, i) => i % 256));
    act(() => {
      for (let offset = 0; offset < pcm.length; offset += 1024) {
        audio.callbacks!.onCaptureData(pcm.subarray(offset, offset + 1024));
      }
    });
    expect(onPcmSegment).toHaveBeenCalledTimes(10);

    await act(() => result.current.stop());
    expect(onPcmSegment).toHaveBeenCalledTimes(11);
    const chunks = onPcmSegment.mock.calls.map(([base64]) => Buffer.from(base64, "base64"));
    expect(chunks.map((chunk) => chunk.length)).toEqual([...Array(10).fill(32_000), 10]);
    expect(Buffer.concat(chunks)).toEqual(pcm);

    await act(() => result.current.stop());
    expect(onPcmSegment).toHaveBeenCalledTimes(11);
  });

  it("flushes short recordings separately without carrying audio into the next recording", async () => {
    const onPcmSegment = vi.fn();
    const { result } = renderHook(() => useDictationAudioSource({ onPcmSegment }));
    const first = Buffer.from([1, 2, 3, 4]);
    const second = Buffer.from([5, 6]);

    await act(() => result.current.start());
    act(() => audio.callbacks!.onCaptureData(first));
    expect(onPcmSegment).not.toHaveBeenCalled();
    await act(() => result.current.stop());

    await act(() => result.current.start());
    act(() => audio.callbacks!.onCaptureData(second));
    await act(() => result.current.stop());
    expect(onPcmSegment.mock.calls).toEqual([
      [first.toString("base64")],
      [second.toString("base64")],
    ]);
  });

  it("preserves the buffered tail before reporting an audio interruption", async () => {
    const events: string[] = [];
    const { result } = renderHook(() =>
      useDictationAudioSource({
        onPcmSegment: (pcm) => events.push(pcm),
        onInterruption: () => events.push("interrupted"),
      }),
    );
    await act(() => result.current.start());
    const pcm = Buffer.from([7, 8]);
    act(() => {
      audio.callbacks!.onCaptureData(pcm);
      audio.callbacks!.onInterruption!();
    });
    expect(events).toEqual([pcm.toString("base64"), "interrupted"]);
    await act(() => result.current.stop());
    expect(events).toHaveLength(2);
  });

  it("discards the stop-time tail when the user cancels dictation", async () => {
    const enqueue = vi.spyOn(DictationStreamSender.prototype, "enqueueSegment");
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation({ client: null, onTranscript }));
    await act(() => result.current.startDictation());
    act(() => audio.callbacks!.onCaptureData(Buffer.from([1, 2])));

    await act(() => result.current.cancelDictation());
    expect(enqueue).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(audio.stopCapture).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("idle");
  });
});
