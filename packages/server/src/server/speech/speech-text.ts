// Markdown → spoken text.
//
// Agent replies are markdown. Handing that string straight to a TTS engine
// makes it read the *syntax*: "hash hash hash Plan", "star star important star
// star", pipe characters between every table cell, and whole URLs out of link
// targets. What should be spoken is what the chat actually renders on screen -
// the text, not the marks that style it.
//
// This is deliberately a lightweight transform rather than a real markdown
// parse: it runs on every utterance in the TTS hot path, it only ever needs to
// produce a plausible sentence, and a mis-stripped emphasis marker is a
// cosmetic problem, not a correctness one. It is applied once, at
// `splitTextForTts`, so every caller (voice mode and the per-message playback
// button alike) gets it.
//
// One deliberate departure from "read what is rendered": fenced code blocks are
// replaced by a short spoken marker instead of being read out. Their content is
// rendered on screen, but reading a diff or a shell transcript aloud character
// by character is noise, and it buries the prose the listener actually wants.
// Inline code is kept - it is almost always a short identifier mid-sentence.

/** Spoken in place of a fenced code block. */
const CODE_BLOCK_SPOKEN = "code block.";

/**
 * Convert markdown to the plain prose a TTS engine should read.
 *
 * Returns a trimmed string; may be empty if the input carried no speakable
 * text (e.g. a reply that was nothing but a horizontal rule). Callers decide
 * what an empty result means - `splitTextForTts` treats it as nothing to say.
 */
export function markdownToSpokenText(markdown: string): string {
  let text = markdown.replace(/\r\n?/g, "\n");

  // Order matters: block-level constructs whose bodies must NOT be re-scanned
  // for inline syntax go first.
  text = stripFencedCodeBlocks(text);
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  const lines = stripBlockMarkers(text);

  // Drop structural lines outright (null), then collapse the runs of blank
  // lines that remain. A dropped rule or table separator must not leave a blank
  // behind - it was never a paragraph break, so it stays distinct from a line
  // that merely trimmed to empty.
  const kept: string[] = [];
  for (const line of lines) {
    if (line === null) {
      continue;
    }
    const trimmed = stripInlineMarkers(line).trim();
    if (!trimmed && (kept.length === 0 || kept[kept.length - 1] === "")) {
      continue;
    }
    kept.push(trimmed);
  }
  return kept.join("\n").trim();
}

function stripFencedCodeBlocks(text: string): string {
  // Closed fences first: both styles, with or without an info string.
  let out = text.replace(
    /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm,
    CODE_BLOCK_SPOKEN,
  );
  // Then a fence left open at the end - a reply cut off mid-block still must
  // not read its contents out.
  out = out.replace(/^[ \t]*(?:`{3,}|~{3,})[^\n]*\n[\s\S]*$/m, CODE_BLOCK_SPOKEN);
  return out;
}

/**
 * Strip block-level markers line by line. Returns null for a line that is pure
 * structure (a horizontal rule, a table separator) so the caller can drop it
 * without leaving a spurious paragraph break behind.
 */
function stripBlockMarkers(text: string): (string | null)[] {
  return text.split("\n").map((line) => {
    // Horizontal rule - nothing to say.
    if (/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) {
      return null;
    }
    // Table separator row (|---|:--:|) - structure, not content.
    if (/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/.test(line)) {
      return null;
    }

    let out = line;
    // Blockquote markers, however deeply nested.
    out = out.replace(/^[ \t]*(?:>[ \t]?)+/, "");
    // ATX heading. Ends with a period so the splitter gives it its own
    // sentence and the voice pauses after it, the way the layout does.
    const heading = /^[ \t]*#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(out);
    if (heading) {
      return appendSentenceStop(heading[1]);
    }
    // List bullet or ordered marker, plus a task-list checkbox if present.
    out = out.replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/, "");
    out = out.replace(/^\[[ xX]\][ \t]+/, "");
    // Table row: speak the cells, separated so they don't run together.
    if (/^\|.*\|[ \t]*$/.test(out)) {
      out = out
        .replace(/^\||\|[ \t]*$/g, "")
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(", ");
    }
    return out;
  });
}

function stripInlineMarkers(text: string): string {
  let out = text;
  // Images before links - an image is a link with a leading "!". Speak the alt
  // text, which is what a screen reader would say, and nothing if there is none.
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Inline links and reference links: keep the label, drop the target.
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  out = out.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  // Bare autolink - a URL read aloud is unlistenable.
  out = out.replace(/<https?:\/\/[^>\s]+>/g, "");
  // Inline code: keep the identifier, drop the backticks.
  out = out.replace(/`([^`\n]+)`/g, "$1");
  // Emphasis, longest marker first so "**x**" isn't eaten as two "*x*".
  out = out.replace(/(\*\*\*|___)(\S(?:[\s\S]*?\S)?)\1/g, "$2");
  out = out.replace(/(\*\*|__)(\S(?:[\s\S]*?\S)?)\1/g, "$2");
  out = out.replace(/(?<![\w*])\*(\S(?:[^*\n]*?\S)?)\*(?![\w*])/g, "$1");
  out = out.replace(/(?<![\w_])_(\S(?:[^_\n]*?\S)?)_(?![\w_])/g, "$1");
  out = out.replace(/~~(\S(?:[\s\S]*?\S)?)~~/g, "$1");
  // Backslash escapes are syntax too - "\*" is spoken as "*".
  out = out.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1");
  return out;
}

/**
 * Give a heading a terminal stop so the sentence splitter treats it as its own
 * utterance - without doubling one it already has.
 */
function appendSentenceStop(heading: string): string {
  const trimmed = heading.trim();
  if (!trimmed) {
    return "";
  }
  return /[.!?:;,]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
