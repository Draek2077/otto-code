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

  it("cuts at an em dash and speaks the pause instead of the dash", () => {
    const segments = splitTextForTts(
      "The server rebuilds everything quickly — the client just waits.",
    );
    expect(segments.map((s) => s.text)).toEqual([
      "The server rebuilds everything quickly",
      "the client just waits.",
    ]);
    expect(segments[0].pauseAfterMs).toBe(TTS_PAUSE_MS.dash);
  });

  it("cuts at a short em-dash break, which the stub guard does not block", () => {
    const segments = splitTextForTts("Rendered above — a four-stop timeline.");
    expect(segments.map((s) => s.text)).toEqual(["Rendered above", "a four-stop timeline."]);
    expect(segments.map((s) => s.pauseAfterMs)).toEqual([TTS_PAUSE_MS.dash, 0]);
  });

  it("sets off a paired em-dash aside at both dashes", () => {
    const segments = splitTextForTts("Are you sure — really sure — that it works?");
    expect(segments.map((s) => s.text)).toEqual(["Are you sure", "really sure", "that it works?"]);
    expect(segments.map((s) => s.pauseAfterMs)).toEqual([TTS_PAUSE_MS.dash, TTS_PAUSE_MS.dash, 0]);
  });

  it("treats a spaced hyphen between words as a break in thought", () => {
    const segments = splitTextForTts("The daemon owns synthesis - the client just plays it.");
    expect(segments.map((s) => s.text)).toEqual([
      "The daemon owns synthesis",
      "the client just plays it.",
    ]);
    expect(segments[0].pauseAfterMs).toBe(TTS_PAUSE_MS.dash);
  });

  it("pauses at both edges of a parenthetical and drops its brackets", () => {
    const segments = splitTextForTts(
      "The daemon owns synthesis (the client only plays it back) and nothing else.",
    );
    expect(segments.map((s) => s.text)).toEqual([
      "The daemon owns synthesis",
      "the client only plays it back",
      "and nothing else.",
    ]);
    expect(segments.map((s) => s.pauseAfterMs)).toEqual([
      TTS_PAUSE_MS.aside,
      TTS_PAUSE_MS.aside,
      0,
    ]);
  });

  it("treats a square-bracketed aside the same as a parenthetical", () => {
    const segments = splitTextForTts(
      "The sword-smith [a well-lit forge] worked through the afternoon.",
    );
    expect(segments.map((s) => s.text)).toEqual([
      "The sword-smith",
      "a well-lit forge",
      "worked through the afternoon.",
    ]);
    expect(segments[0].pauseAfterMs).toBe(TTS_PAUSE_MS.aside);
  });

  it("sets off a short aside at both edges, regardless of length", () => {
    const segments = splitTextForTts("It shipped (finally) on a Friday afternoon.");
    expect(segments.map((s) => s.text)).toEqual([
      "It shipped",
      "finally",
      "on a Friday afternoon.",
    ]);
    expect(segments.map((s) => s.pauseAfterMs)).toEqual([
      TTS_PAUSE_MS.aside,
      TTS_PAUSE_MS.aside,
      0,
    ]);
  });

  it("drops a closing bracket that butts against terminal punctuation", () => {
    const segments = splitTextForTts("The whole run stayed green (on the first try).");
    expect(segments.map((s) => s.text)).toEqual([
      "The whole run stayed green",
      "on the first try.",
    ]);
  });

  it("leaves brackets alone when they are not set off by whitespace", () => {
    const segments = splitTextForTts("Call parseConfig(options) before the daemon starts.");
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toContain("parseConfig(options)");
  });

  it("speaks a dash between numbers as a range, not a pause", () => {
    const segments = splitTextForTts("The retry window is 2–4 seconds on a warm cache.");
    expect(segments.map((s) => s.text)).toEqual([
      "The retry window is 2 to 4 seconds on a warm cache.",
    ]);
  });

  it("speaks a hyphenated number range as a range too", () => {
    const segments = splitTextForTts("Expect 10-20 minutes for the whole verification run.");
    expect(segments[0].text).toBe("Expect 10 to 20 minutes for the whole verification run.");
  });

  it("speaks a date as words rather than arithmetic", () => {
    const segments = splitTextForTts("The release landed on 2026-07-25 without a hitch.");
    // The comma the spoken date brings with it is a real pause — a date is
    // read with a beat between the day and the year.
    expect(segments.map((s) => s.text)).toEqual([
      "The release landed on July twenty-fifth,",
      "twenty twenty-six without a hitch.",
    ]);
    expect(segments[0].pauseAfterMs).toBe(TTS_PAUSE_MS.comma);
  });

  it("leaves phone numbers and version strings alone", () => {
    for (const literal of ["555-1234", "1-2-3"]) {
      const segments = splitTextForTts(`The value written down was ${literal} exactly.`);
      expect(segments[0].text).toContain(literal);
    }
  });

  it("leaves a hyphenated word completely untouched", () => {
    const segments = splitTextForTts("The sword-smith worked through a well-lit afternoon.");
    expect(segments.map((s) => s.text)).toEqual([
      "The sword-smith worked through a well-lit afternoon.",
    ]);
  });

  it("keeps a question's mark on the fragment that carries the rise", () => {
    const segments = splitTextForTts(
      "When the daemon splits a sentence, does the voice still raise its pitch at the end?",
    );
    expect(segments.map((s) => s.text)).toEqual([
      "When the daemon splits a sentence,",
      "does the voice still raise its pitch at the end?",
    ]);
  });

  it("keeps terminal punctuation on every sentence it hands the provider", () => {
    const segments = splitTextForTts("Is it ready? It is ready. Ship it!");
    expect(segments.map((s) => s.text)).toEqual(["Is it ready?", "It is ready.", "Ship it!"]);
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
