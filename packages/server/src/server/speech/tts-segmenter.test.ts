import { describe, expect, it } from "vitest";

import { appendPauseSilence, splitTextForTts, TTS_PAUSE_MS } from "./tts-segmenter.js";

describe("splitTextForTts", () => {
  it("gives each sentence a full-stop pause and the final segment none", () => {
    const segments = splitTextForTts("First sentence. Second sentence! Third?");
    expect(segments.map((s) => s.text)).toEqual(["First sentence.", "Second sentence!", "Third?"]);
    expect(segments.map((s) => s.pauseAfterMs)).toEqual([
      TTS_PAUSE_MS.sentence,
      TTS_PAUSE_MS.sentence,
      0,
    ]);
  });

  it("cuts at commas once the clause is long enough", () => {
    const segments = splitTextForTts(
      "First we build the server carefully, then we ship the client, and we test.",
    );
    expect(segments.map((s) => s.text)).toEqual([
      "First we build the server carefully,",
      "then we ship the client,",
      "and we test.",
    ]);
    expect(segments.map((s) => s.pauseAfterMs)).toEqual([
      TTS_PAUSE_MS.comma,
      TTS_PAUSE_MS.comma,
      0,
    ]);
  });

  it("keeps a short leading clause glued to its sentence", () => {
    const segments = splitTextForTts("So, we ship it today.");
    expect(segments).toEqual([{ index: 0, text: "So, we ship it today.", pauseAfterMs: 0 }]);
  });

  it("weights semicolons and colons above commas", () => {
    const segments = splitTextForTts(
      "The daemon owns the synthesis pipeline; the client owns nothing but playback. " +
        "One thing matters above all others: the cadence of the spoken reply.",
    );
    expect(segments.map((s) => s.pauseAfterMs)).toEqual([
      TTS_PAUSE_MS.semicolon,
      TTS_PAUSE_MS.sentence,
      TTS_PAUSE_MS.colon,
      0,
    ]);
  });

  it("cuts at an em dash and drops the dash from the spoken text", () => {
    const segments = splitTextForTts(
      "The server rebuilds everything quickly — the client just waits.",
    );
    expect(segments.map((s) => s.text)).toEqual([
      "The server rebuilds everything quickly",
      "the client just waits.",
    ]);
    expect(segments[0].pauseAfterMs).toBe(TTS_PAUSE_MS.dash);
  });

  it("restores a dropped dash when the left side is too short to cut", () => {
    const segments = splitTextForTts("One thing — the tests must stay green here.");
    expect(segments.map((s) => s.text)).toEqual(["One thing — the tests must stay green here."]);
  });

  it("treats a blank line as a paragraph pause", () => {
    const segments = splitTextForTts("First paragraph.\n\nSecond paragraph.");
    expect(segments.map((s) => s.pauseAfterMs)).toEqual([TTS_PAUSE_MS.paragraph, 0]);
  });

  it("reads unpunctuated bullet lines with a semicolon-grade pause", () => {
    const segments = splitTextForTts("- Fast startup\n- Small chunks\n- Natural cadence");
    expect(segments.map((s) => s.text)).toEqual([
      "Fast startup",
      "Small chunks",
      "Natural cadence",
    ]);
    expect(segments.map((s) => s.pauseAfterMs)).toEqual([
      TTS_PAUSE_MS.bullet,
      TTS_PAUSE_MS.bullet,
      0,
    ]);
  });

  it("keeps the full stop on a bullet that is a complete sentence", () => {
    const segments = splitTextForTts("- The build is green.\n- Ship it");
    expect(segments.map((s) => s.pauseAfterMs)).toEqual([TTS_PAUSE_MS.sentence, 0]);
  });

  it("does not split numbers or times at their internal punctuation", () => {
    const segments = splitTextForTts(
      "The meeting at 3:30 covered 1,000 test runs across the whole electrified build matrix.",
    );
    expect(segments).toHaveLength(1);
  });

  it("word-splits an oversized clause-free run without inventing pauses", () => {
    const longRun = Array.from({ length: 60 }, () => "word").join(" ");
    const segments = splitTextForTts(`${longRun}.`);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.text.length).toBeLessThanOrEqual(260);
    }
    expect(segments.slice(0, -1).every((s) => s.pauseAfterMs === 0)).toBe(true);
    expect(segments[segments.length - 1].pauseAfterMs).toBe(0);
  });

  it("throws when the input has no speakable text", () => {
    expect(() => splitTextForTts("---")).toThrow("Cannot synthesize empty text");
  });
});

describe("appendPauseSilence", () => {
  it("appends rate-scaled zero samples to pcm audio", () => {
    const audio = Buffer.from([1, 2, 3, 4]);
    const padded = appendPauseSilence(audio, "pcm;rate=24000", 100);
    // 100ms at 24kHz mono PCM16 = 2400 samples = 4800 bytes of silence.
    expect(padded.length).toBe(4 + 4800);
    expect(padded.subarray(0, 4)).toEqual(audio);
    expect(padded.subarray(4).every((byte) => byte === 0)).toBe(true);
  });

  it("assumes 24 kHz for the bare pcm format", () => {
    const padded = appendPauseSilence(Buffer.alloc(2), "pcm", 100);
    expect(padded.length).toBe(2 + 4800);
  });

  it("leaves compressed formats untouched", () => {
    const audio = Buffer.from([9, 9, 9]);
    expect(appendPauseSilence(audio, "mp3", 400)).toBe(audio);
  });

  it("returns the buffer unchanged for a zero pause", () => {
    const audio = Buffer.from([5, 6]);
    expect(appendPauseSilence(audio, "pcm;rate=24000", 0)).toBe(audio);
  });
});
