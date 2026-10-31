import { describe, expect, it, vi } from "vitest";
import { createSpeechPlayback } from "./playback";
import { speechDeferred } from "../../../test-speech";
const audio = { base64: "AA==", mimeType: "audio/wav" };
function fixture() {
  const generation = speechDeferred<typeof audio>();
  const output = speechDeferred<void>();
  const port = {
    prepare: vi.fn(async (_hostId: string, text: string) => [{ text, pauseAfterMs: 0 }]),
    available: vi.fn(() => true),
    occupied: vi.fn(() => false),
    synthesize: vi.fn((_input: { requestId: string }) => generation.promise),
    cancel: vi.fn(async () => {}),
    play: vi.fn((_audio: typeof audio, _signal: AbortSignal, _cue: boolean) => output.promise),
  };
  return { playback: createSpeechPlayback(port), port, generation, output };
}
const settle = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};
describe("shared speech playback", () => {
  it("gives all capture owners priority without saving a stale narration backlog", async () => {
    const { playback, port, generation } = fixture();
    playback.speak({ hostId: "host", key: "first", text: "Old speech." });
    await settle();
    const first = playback.retainCapture();
    const second = playback.retainCapture();
    expect(port.cancel).toHaveBeenCalledTimes(1);
    generation.resolve(audio);
    playback.speak({ hostId: "host", key: "during", text: "Do not queue.", automatic: true });
    first();
    first();
    playback.speak({ hostId: "host", key: "still", text: "Still recording." });
    await settle();
    expect(port.synthesize).toHaveBeenCalledTimes(1);
    expect(port.play).not.toHaveBeenCalled();
    second();
    playback.speak({ hostId: "host", key: "fresh", text: "Fresh speech." });
    await settle();
    expect(port.synthesize).toHaveBeenCalledTimes(2);
    expect(port.play).toHaveBeenCalledTimes(1);
    playback.close();
  });
  it("prefetches only one segment and cancels it without playing late audio", async () => {
    const { playback, port, output } = fixture();
    const ahead = speechDeferred<typeof audio>();
    port.prepare.mockResolvedValue([
      { text: "One.", pauseAfterMs: 400 },
      { text: "Two.", pauseAfterMs: 400 },
      { text: "Three.", pauseAfterMs: 0 },
    ]);
    port.synthesize.mockResolvedValueOnce(audio).mockImplementationOnce(() => ahead.promise);
    playback.speak({ hostId: "host", key: "read", text: "One. Two. Three." });
    await settle();
    expect(port.synthesize).toHaveBeenCalledTimes(2);
    expect(port.play).toHaveBeenCalledTimes(1);
    const pending = port.synthesize.mock.calls[1]![0];
    playback.stop();
    expect(port.cancel).toHaveBeenCalledWith("host", pending.requestId);
    ahead.resolve(audio);
    output.resolve();
    await settle();
    expect(port.synthesize).toHaveBeenCalledTimes(2);
    expect(port.play).toHaveBeenCalledTimes(1);
    playback.close();
  });
  it("exposes pending and playback state, and starts the next queued reply only after audio finishes", async () => {
    const { playback, port, generation, output } = fixture();
    playback.speak({ hostId: "host", key: "one", text: "One.", automatic: true });
    playback.speak({ hostId: "host", key: "two", text: "Two.", automatic: true });
    expect(playback.getSnapshot()).toMatchObject({ key: "one", phase: "generating" });
    await settle();
    expect(port.synthesize).toHaveBeenCalledTimes(1);
    generation.resolve(audio);
    await settle();
    expect(playback.getSnapshot().phase).toBe("playing");
    expect(port.play).toHaveBeenCalledTimes(1);
    output.resolve();
    await settle();
    expect(port.synthesize).toHaveBeenCalledTimes(2);
    expect(playback.getSnapshot().phase).toBe("idle");
    playback.close();
  });
  it("stops an owned request immediately and never plays its late result", async () => {
    const { playback, port, generation } = fixture();
    playback.speak({ hostId: "host", key: "one", text: "One." });
    await settle();
    const request = port.synthesize.mock.calls[0]![0];
    playback.stop();
    expect(port.cancel).toHaveBeenCalledWith("host", request.requestId);
    expect(playback.getSnapshot().phase).toBe("idle");
    generation.resolve(audio);
    await settle();
    expect(port.play).not.toHaveBeenCalled();
    playback.close();
  });
  it("a cancelled older request cannot clear a newer request's state", async () => {
    const { playback, port, generation, output } = fixture();
    const newer = speechDeferred<typeof audio>();
    port.synthesize
      .mockImplementationOnce(() => generation.promise)
      .mockImplementationOnce(() => newer.promise);
    playback.speak({ hostId: "host", key: "old", text: "Old." });
    await settle();
    playback.speak({ hostId: "host", key: "new", text: "New." });
    generation.resolve(audio);
    await settle();
    expect(playback.getSnapshot().key).toBe("new");
    newer.resolve(audio);
    await settle();
    expect(port.play).toHaveBeenCalledTimes(1);
    output.resolve();
    await settle();
    playback.close();
  });
  it("gives live voice exclusive output ownership and cancels narration before it can play", async () => {
    const { playback, port, generation } = fixture();
    playback.speak({ hostId: "host", key: "one", text: "One." });
    await settle();
    port.occupied.mockReturnValue(true);
    playback.reconcile();
    playback.speak({ hostId: "host", key: "two", text: "Two." });
    generation.resolve(audio);
    await settle();
    expect(port.synthesize).toHaveBeenCalledTimes(1);
    expect(port.play).not.toHaveBeenCalled();
    playback.close();
  });
  it("keeps a failure visible for the originating chat and permits an explicit retry", async () => {
    const { playback, port, generation } = fixture();
    playback.speak({ hostId: "host", key: "failed", text: "One." });
    await settle();
    generation.reject(new Error("vendor secret"));
    await settle();
    expect(playback.getSnapshot()).toMatchObject({ phase: "idle", errorKey: "failed" });
    expect(playback.getSnapshot().error).toContain("Speech playback failed");
    expect(playback.getSnapshot().error).not.toContain("vendor secret");
    port.synthesize.mockResolvedValue(audio);
    playback.speak({ hostId: "host", key: "failed", text: "One." });
    await settle();
    expect(port.play).toHaveBeenCalledTimes(1);
    playback.close();
  });
  it("muting activity cues preserves queued narration from other chats", async () => {
    const { playback, port, generation, output } = fixture();
    playback.speak({ hostId: "host", key: "cue", text: "Thinking.", cue: true, automatic: true });
    await settle();
    playback.speak({ hostId: "host", key: "reply", text: "A reply.", automatic: true });
    playback.cancelCues();
    generation.resolve(audio);
    await settle();
    expect(port.synthesize).toHaveBeenCalledTimes(2);
    expect(playback.getSnapshot().key).toBe("reply");
    expect(port.play.mock.calls[0]?.[2]).toBe(false);
    output.resolve();
    await settle();
    playback.close();
  });
  it("stops owned playback on disconnect and refuses to queue while disconnected", async () => {
    const { playback, port, generation } = fixture();
    playback.speak({ hostId: "host", key: "one", text: "One." });
    await settle();
    port.available.mockReturnValue(false);
    playback.reconcile();
    generation.resolve(audio);
    await settle();
    expect(port.play).not.toHaveBeenCalled();
    playback.speak({ hostId: "host", key: "two", text: "Two." });
    expect(playback.getSnapshot().error).toContain("reconnect");
    expect(port.synthesize).toHaveBeenCalledTimes(1);
    playback.close();
  });
  it("does not accumulate automatic replies during a manual interruption", async () => {
    const { playback, port, generation, output } = fixture();
    playback.speak({ hostId: "host", key: "manual", text: "Manual." });
    await settle();
    playback.speak({
      hostId: "host",
      key: "stale",
      text: "Arrived during manual playback.",
      automatic: true,
    });
    generation.resolve(audio);
    output.resolve();
    await settle();
    expect(port.synthesize).toHaveBeenCalledTimes(1);
    playback.speak({ hostId: "host", key: "future", text: "Future reply.", automatic: true });
    await settle();
    expect(port.synthesize).toHaveBeenCalledTimes(2);
    playback.close();
  });
  it("bounds complete replies before sending any preparation request", () => {
    const { playback, port } = fixture();
    playback.speak({ hostId: "host", key: "large", text: "x".repeat(65537) });
    expect(port.prepare).not.toHaveBeenCalled();
    expect(playback.getSnapshot().errorKey).toBe("large");
    playback.close();
  });
});
