// Sentence- and clause-level segmentation for TTS, plus the explicit pause
// synthesized after each segment.
//
// Every segment below becomes its own provider request, and the client splices
// the resulting buffers together gapless (the audio engines start chunk N+1 the
// instant chunk N ends). A TTS model only renders the pause a punctuation mark
// implies while the text around the mark sits inside one request — at a request
// boundary that silence never exists in any buffer. And even inside one
// request, the local Kokoro frontend flattens most punctuation. So cadence is
// synthesized deliberately: the mark that ends a segment maps to a silence
// duration here, and `appendPauseSilence` pads the segment's PCM with that many
// zero samples. Splitting at clause marks (not just sentence ends) also keeps
// synthesis requests small, so the first audio arrives sooner.

import { parsePcmRateFromFormat } from "./audio.js";
import { markdownToSpokenText } from "./speech-text.js";

export interface TtsSegment {
  index: number;
  text: string;
  /** Silence appended after this segment's audio — the spoken form of the
   * punctuation or block break that ended it. Always 0 on the final segment. */
  pauseAfterMs: number;
}

/**
 * Pause durations, one per punctuation meaning. English punctuation is pause
 * notation — each mark tells the reader how long the voice rests — so the
 * durations are ordered by the weight of the break the mark denotes. This
 * table is the single tuning point; nothing else encodes a duration.
 */
export const TTS_PAUSE_MS = {
  /** `,` — a breath between clauses; the lightest break there is. */
  comma: 180,
  /** `—` `–` — sets off an aside; the voice hangs a beat longer than a comma. */
  dash: 250,
  /** `;` — joins two independent clauses; nearly a stop, without the finality. */
  semicolon: 300,
  /** `:` — announces what follows; carries a semicolon's weight. */
  colon: 300,
  /** A line break with no terminal punctuation — a bullet fragment. List items
   * read with a semicolon's pause between them, not a full stop. */
  bullet: 300,
  /** `.` `!` `?` `…` — the thought is complete; a full stop. */
  sentence: 400,
  /** A blank line — a topic shift; the longest rest. */
  paragraph: 700,
} as const;

/** Hard ceiling per synthesis request; keeps every provider call small. */
const MAX_TTS_SEGMENT_CHARS = 260;

/**
 * Never cut a clause shorter than this. A leading "So," or "First," stays
 * glued to its sentence — a hard pause after a two-word fragment reads as a
 * stammer, and Kokoro gives isolated stubs odd prosody.
 */
const MIN_CLAUSE_CHARS = 24;

/** `.` `!` `?` `…`, allowing a closing quote/bracket after the mark. */
const TERMINAL_PUNCTUATION = /[.!?…]["')\]]*$/;

interface ClausePiece {
  /** Clause text; keeps its trailing `,` `;` `:` (the dash is dropped — its
   * pause replaces it, and `join` restores it if the piece is merged instead). */
  text: string;
  /** Pause implied by the boundary that ended this piece; null at sentence end
   * (the caller assigns the sentence-level pause). */
  pauseMs: number | null;
  /** Separator to restore when this piece merges with the next one. */
  join: string;
}

// `,` `;` `:` count only before whitespace so "1,000" and "3:30" stay whole.
// Em/en dashes split spaced or not — identifiers never contain them (unlike
// `--`, which is a CLI flag prefix and is deliberately NOT a boundary).
const CLAUSE_BOUNDARY = /([,;:])\s+|\s*[—–]+\s*/g;

function pauseForMark(mark: string): number {
  switch (mark) {
    case ",":
      return TTS_PAUSE_MS.comma;
    case ";":
      return TTS_PAUSE_MS.semicolon;
    case ":":
      return TTS_PAUSE_MS.colon;
    default:
      return TTS_PAUSE_MS.dash;
  }
}

function tokenizeClauses(sentence: string): ClausePiece[] {
  const pieces: ClausePiece[] = [];
  let lastIndex = 0;
  CLAUSE_BOUNDARY.lastIndex = 0;
  for (
    let match = CLAUSE_BOUNDARY.exec(sentence);
    match !== null;
    match = CLAUSE_BOUNDARY.exec(sentence)
  ) {
    const mark = match[1];
    const end = mark ? match.index + 1 : match.index;
    const text = sentence.slice(lastIndex, end).trim();
    if (text) {
      pieces.push({
        text,
        pauseMs: pauseForMark(mark ?? "—"),
        join: mark ? " " : " — ",
      });
    }
    lastIndex = match.index + match[0].length;
  }
  const tail = sentence.slice(lastIndex).trim();
  if (tail) {
    pieces.push({ text: tail, pauseMs: null, join: " " });
  }
  return pieces;
}

interface RawFragment {
  text: string;
  pauseAfterMs: number;
}

/** Word-boundary fallback for a monster fragment with no clause marks at all.
 * Inner cuts get no pause — they are mid-phrase splices, same as ever. */
function hardSplitOversized(fragment: RawFragment): RawFragment[] {
  if (fragment.text.length <= MAX_TTS_SEGMENT_CHARS) {
    return [fragment];
  }
  const parts: RawFragment[] = [];
  let remaining = fragment.text;
  while (remaining.length > MAX_TTS_SEGMENT_CHARS) {
    let idx = remaining.lastIndexOf(" ", MAX_TTS_SEGMENT_CHARS);
    if (idx < Math.floor(MAX_TTS_SEGMENT_CHARS * 0.5)) {
      idx = MAX_TTS_SEGMENT_CHARS;
    }
    const part = remaining.slice(0, idx).trim();
    if (part) {
      parts.push({ text: part, pauseAfterMs: 0 });
    }
    remaining = remaining.slice(idx).trim();
  }
  if (remaining) {
    parts.push({ text: remaining, pauseAfterMs: fragment.pauseAfterMs });
  } else if (parts.length > 0) {
    parts[parts.length - 1].pauseAfterMs = fragment.pauseAfterMs;
  }
  return parts;
}

/**
 * Split one sentence into clause fragments. Clauses accumulate until they are
 * at least MIN_CLAUSE_CHARS, then cut at the next boundary with that mark's
 * pause. The final fragment's pause is a placeholder — the caller overrides it
 * with the sentence/bullet/paragraph pause that actually follows.
 */
function splitSentence(sentence: string): RawFragment[] {
  const fragments: RawFragment[] = [];
  let current = "";
  let currentJoin = " ";
  let lastPauseMs: number = TTS_PAUSE_MS.comma;

  for (const piece of tokenizeClauses(sentence)) {
    const candidate = current ? `${current}${currentJoin}${piece.text}` : piece.text;
    if (current && candidate.length > MAX_TTS_SEGMENT_CHARS) {
      fragments.push({ text: current, pauseAfterMs: lastPauseMs });
      current = piece.text;
    } else {
      current = candidate;
    }
    currentJoin = piece.join;
    if (piece.pauseMs !== null) {
      lastPauseMs = piece.pauseMs;
      if (current.length >= MIN_CLAUSE_CHARS) {
        fragments.push({ text: current, pauseAfterMs: piece.pauseMs });
        current = "";
        currentJoin = " ";
      }
    }
  }
  if (current) {
    fragments.push({ text: current, pauseAfterMs: TTS_PAUSE_MS.sentence });
  }
  return fragments.flatMap(hardSplitOversized);
}

/**
 * Split spoken text into synthesis segments, each carrying the pause owed
 * after it. Block structure survives from `markdownToSpokenText`: single
 * newlines separate lines (list items, headings), blank lines separate
 * paragraphs — both are pause boundaries, both would otherwise be destroyed
 * by whitespace collapsing.
 */
export function splitTextForTts(text: string): TtsSegment[] {
  const spoken = markdownToSpokenText(text);
  if (!spoken) {
    throw new Error("Cannot synthesize empty text");
  }

  const raw: RawFragment[] = [];
  const paragraphs = spoken.split(/\n\s*\n/);
  for (let p = 0; p < paragraphs.length; p += 1) {
    const paragraphStart = raw.length;
    for (const line of paragraphs[p].split("\n")) {
      const normalized = line.replace(/\s+/g, " ").trim();
      if (!normalized) {
        continue;
      }
      const lineStart = raw.length;
      for (const sentence of normalized.split(/(?<=[.!?…])\s+/)) {
        const fragments = splitSentence(sentence.trim());
        if (fragments.length === 0) {
          continue;
        }
        fragments[fragments.length - 1].pauseAfterMs = TTS_PAUSE_MS.sentence;
        raw.push(...fragments);
      }
      // The line's final pause: a full stop if the line ends like a sentence,
      // a bullet's semicolon-grade pause if it trails off unpunctuated.
      if (raw.length > lineStart && !TERMINAL_PUNCTUATION.test(normalized)) {
        raw[raw.length - 1].pauseAfterMs = TTS_PAUSE_MS.bullet;
      }
    }
    if (raw.length > paragraphStart && p < paragraphs.length - 1) {
      raw[raw.length - 1].pauseAfterMs = TTS_PAUSE_MS.paragraph;
    }
  }

  if (raw.length === 0) {
    throw new Error("Cannot synthesize empty text");
  }
  raw[raw.length - 1].pauseAfterMs = 0;
  return raw.map((fragment, index) => ({
    index,
    text: fragment.text,
    pauseAfterMs: fragment.pauseAfterMs,
  }));
}

// OpenAI's raw-PCM endpoint is fixed at 24 kHz and reports the bare format
// string "pcm"; the app's audio engines assume the same default (see
// packages/app/src/voice/audio-format.ts).
const BARE_PCM_FALLBACK_RATE = 24000;

/**
 * Append `pauseMs` of silence to a segment's audio. Only raw PCM16 mono can be
 * padded by appending zero samples; compressed or containered formats pass
 * through untouched (their cadence stays model-rendered).
 */
export function appendPauseSilence(buffer: Buffer, format: string, pauseMs: number): Buffer {
  if (pauseMs <= 0) {
    return buffer;
  }
  if (!/^pcm\b/i.test(format.trim())) {
    return buffer;
  }
  const rate = parsePcmRateFromFormat(format, BARE_PCM_FALLBACK_RATE);
  if (!rate) {
    return buffer;
  }
  const samples = Math.round((rate * pauseMs) / 1000);
  if (samples <= 0) {
    return buffer;
  }
  return Buffer.concat([buffer, Buffer.alloc(samples * 2)]);
}
