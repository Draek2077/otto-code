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
//
// Punctuation splits into two kinds, and they are handled oppositely:
//
//   1. Marks the voice PRONOUNCES — `,` `;` `:` and the terminal `.` `?` `!`.
//      These shape pitch, not just timing: a question mark is the difference
//      between asking and stating. They stay in the segment text exactly as
//      written, and a segment always keeps the terminal mark of the sentence
//      it ends, so the closing rise or fall survives the cut.
//   2. Marks that are pure NOTATION — em dashes, spaced dashes, and brackets.
//      A voice does not say them; it rests where they sit. They are consumed
//      at the boundary and re-expressed as silence, which is more reliable
//      than hoping the model infers a rest from a glyph.
//
// A break the author marked explicitly (a dash, a bracket) is also always
// worth a pause, however short the phrase around it — only the inferred
// comma-grade splits have to clear the stub guard.

import { parsePcmRateFromFormat } from "./audio.js";
import { normalizeSpokenForms } from "./spoken-forms.js";
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
  /** `(…)` `[…]` — brackets set an aside off from the sentence around it, so
   * the voice rests at BOTH edges. Comma-grade by default; its own entry so it
   * can be tuned without moving every comma in the language. */
  aside: 180,
  /** A break in thought: an em dash, or any dash with space on both sides
   * ("synthesis - the client"). Spacing is what makes a dash a break — an
   * unspaced hyphen belongs to its word ("sword-smith", "well-lit") and is
   * never a boundary, and a dash between numbers is a range ("2–4" is "2 to
   * 4", rewritten by `normalizeSpokenForms` before any splitting). */
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
  /** Clause text. Pronounced marks stay exactly as written — a trailing `,`
   * `;` `:`, and whatever terminal mark the sentence carries. Notation marks
   * (dashes, brackets) are gone: the pause replaced them. */
  text: string;
  /** Pause implied by the boundary that ended this piece; null at sentence end
   * (the caller assigns the sentence-level pause). */
  pauseMs: number | null;
  /** An explicitly authored break — a dash or a bracket edge, as opposed to an
   * inferred comma-grade split. These earn their pause at any length, so the
   * stub guard does not apply to them. */
  isExplicitBreak: boolean;
}

// Clause boundaries, one alternation each:
//  - `,` `;` `:` before whitespace. The mark stays on the left piece; it is
//    pronounced. "1,000" and "3:30" have no whitespace after the mark, so they
//    are never boundaries.
//  - a dash with whitespace on BOTH sides, of any kind — that spacing is what
//    turns a dash into a break in thought. "sword-smith" has none and is left
//    alone, and so is `--`, which is a CLI flag prefix.
//  - an em dash with no spacing ("word—word"), which is a break regardless.
//  - the whitespace around a WELL-FORMED bracketed aside: an opening bracket
//    with whitespace in front of it and a closing partner ahead. Both edges
//    test for the whole construct, so a call like "parseConfig(options)" —
//    whose bracket opens tight against a word — is never torn apart at either
//    end. The brackets themselves are trimmed off the pieces by
//    `trimNotationMarks`; a voice rests at a bracket, it does not say it.
const CLAUSE_BOUNDARY =
  /([,;:])\s+|\s+[-–—]+\s+|—+|\s+(?=[([][^)\]]*[)\]])|(?<=\s[([][^)\]]*[)\]])\s+/g;

/**
 * Strip notation marks left at a fragment's edges. The boundary regex consumes
 * dashes as it splits, but brackets are matched by lookaround (so that
 * "foo(bar)" mid-phrase is never torn apart) and a closing bracket that butts
 * against terminal punctuation — "(finally)." — is not followed by whitespace
 * at all, so both need cleaning up here. Terminal punctuation is preserved:
 * only the notation in front of it goes.
 */
function trimNotationMarks(text: string): string {
  return text
    .replace(/^[\s([{—–]+/, "")
    .replace(/[)\]}—–]+(?=["']*[.,;:!?…]*$)/, "")
    .trim();
}

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
    let end: number;
    let pauseMs: number;
    let isExplicitBreak = true;
    if (match[1]) {
      // Pronounced mark — it stays on the piece it closes.
      end = match.index + 1;
      pauseMs = pauseForMark(match[1]);
      isExplicitBreak = false;
    } else if (/[-–—]/.test(match[0])) {
      // Dash: notation. Everything it matched is dropped.
      end = match.index;
      pauseMs = TTS_PAUSE_MS.dash;
    } else {
      // Bracket edge — only whitespace is matched; `trimNotationMarks` takes
      // the bracket itself off the piece.
      end = match.index;
      pauseMs = TTS_PAUSE_MS.aside;
    }
    const text = trimNotationMarks(sentence.slice(lastIndex, end));
    if (text) {
      pieces.push({ text, pauseMs, isExplicitBreak });
    }
    lastIndex = match.index + match[0].length;
  }
  const tail = trimNotationMarks(sentence.slice(lastIndex));
  if (tail) {
    pieces.push({ text: tail, pauseMs: null, isExplicitBreak: false });
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
 *
 * A question is cut like any other sentence. Its rise lands on the closing
 * fragment, which is the one that keeps the `?`, so the contour survives —
 * splitting only costs the inflection if the mark is separated from the words
 * it belongs to, which never happens here.
 */
function splitSentence(sentence: string): RawFragment[] {
  const fragments: RawFragment[] = [];
  let current = "";
  let lastPauseMs: number = TTS_PAUSE_MS.comma;

  for (const piece of tokenizeClauses(sentence)) {
    const candidate = current ? `${current} ${piece.text}` : piece.text;
    if (current && candidate.length > MAX_TTS_SEGMENT_CHARS) {
      fragments.push({ text: current, pauseAfterMs: lastPauseMs });
      current = piece.text;
    } else {
      current = candidate;
    }
    if (piece.pauseMs !== null) {
      lastPauseMs = piece.pauseMs;
      // A break the author marked — a dash or a bracket — is set off at any
      // length: "Are you sure" before an em dash is a complete prosodic unit
      // the way a two-word comma stub is not. Inferred splits clear the guard.
      if (piece.isExplicitBreak || current.length >= MIN_CLAUSE_CHARS) {
        fragments.push({ text: current, pauseAfterMs: piece.pauseMs });
        current = "";
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
      const normalized = normalizeSpokenForms(line.replace(/\s+/g, " ").trim());
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
