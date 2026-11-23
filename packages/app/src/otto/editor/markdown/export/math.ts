/**
 * TeX math (`$x^2$`, `$$\int_0^1$$`) for the shared markdown renderer.
 *
 * Unlike task lists, alerts and footnotes, math cannot be a rewrite into
 * existing node types: a formula needs real layout, so it has to reach the
 * renderer as its own node carrying the TeX. That is why this is the one
 * markdown extension here that ships a render rule as well as a parse rule.
 *
 * The parse half is a **markdown-it inline rule and block rule**, not a core
 * ruler pass, because `$` has to be claimed during tokenization: a core rule
 * runs after emphasis and links have already chewed through the `_` and `^`
 * inside a formula.
 */

/** The tokens this produces; both carry the TeX in `content`. */
export const MATH_INLINE_TOKEN = "math_inline";
export const MATH_BLOCK_TOKEN = "math_block";

export interface MathToken {
  type: string;
  content: string;
  markup?: string;
  map?: [number, number] | null;
  block?: boolean;
}

type Nesting = 1 | 0 | -1;

interface MathInlineState {
  src: string;
  pos: number;
  posMax: number;
  push: (type: string, tag: string, nesting: Nesting) => MathToken;
}

interface MathBlockState {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  lineMax: number;
  line: number;
  push: (type: string, tag: string, nesting: Nesting) => MathToken;
}

interface MarkdownItWithRulers {
  inline: {
    ruler: {
      before: (
        target: string,
        name: string,
        rule: (state: MathInlineState, silent: boolean) => boolean,
      ) => void;
    };
  };
  block: {
    ruler: {
      before: (
        target: string,
        name: string,
        rule: (
          state: MathBlockState,
          startLine: number,
          endLine: number,
          silent: boolean,
        ) => boolean,
        options?: { alt: string[] },
      ) => void;
    };
  };
}

const DOLLAR = 0x24;

function isSpace(character: string | undefined): boolean {
  return character === undefined || /\s/.test(character);
}

/**
 * `$…$`, with the rules that keep prose out of it.
 *
 * Currency is the whole problem: "it cost $5 and $10" must not become a
 * formula. Three guards do it, and they are the same three every markdown math
 * implementation converged on. The opening `$` must be followed by a non-space,
 * the closing `$` must be preceded by one, and a digit immediately after the
 * closing `$` disqualifies the match.
 */
function mathInlineRule(state: MathInlineState, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== DOLLAR) {
    return false;
  }
  const start = state.pos + 1;
  // `$$` opens display math, which the block rule owns.
  if (state.src.charCodeAt(start) === DOLLAR) {
    return false;
  }
  if (start >= state.posMax || isSpace(state.src[start])) {
    return false;
  }

  let end = -1;
  for (let index = start; index < state.posMax; index += 1) {
    const character = state.src[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "$") {
      if (!isSpace(state.src[index - 1])) {
        end = index;
      }
      break;
    }
  }
  if (end < 0) {
    return false;
  }
  // "$5 and $10" closes on the second `$` with a digit after it.
  if (/[0-9]/.test(state.src[end + 1] ?? "")) {
    return false;
  }

  if (!silent) {
    const token = state.push(MATH_INLINE_TOKEN, "math", 0);
    token.content = state.src.slice(start, end);
    token.markup = "$";
  }
  state.pos = end + 1;
  return true;
}

/** `$$ … $$`, either on one line or fenced across several. */
function mathBlockRule(
  state: MathBlockState,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.src.slice(start, start + 2) !== "$$") {
    return false;
  }

  const firstLine = state.src.slice(start + 2, max);
  // `$$x$$` all on one line.
  const singleLine = firstLine.trimEnd().endsWith("$$") && firstLine.trim() !== "$$";
  let content: string;
  let lastLine = startLine;

  if (singleLine) {
    content = firstLine.trimEnd().slice(0, -2);
  } else {
    let scan = startLine + 1;
    let closed = false;
    for (; scan < endLine && scan < state.lineMax; scan += 1) {
      const lineStart = state.bMarks[scan] + state.tShift[scan];
      if (state.src.slice(lineStart, state.eMarks[scan]).trim() === "$$") {
        closed = true;
        break;
      }
    }
    // An unclosed `$$` is not math. Swallowing the rest of the document as a
    // formula because a delimiter was mistyped is the worst possible failure.
    if (!closed) {
      return false;
    }
    const bodyStart = state.bMarks[startLine + 1] ?? max;
    const bodyEnd = state.eMarks[scan - 1] ?? max;
    content = firstLine + (scan > startLine + 1 ? state.src.slice(bodyStart, bodyEnd) : "");
    lastLine = scan;
  }

  if (silent) {
    return true;
  }

  const token = state.push(MATH_BLOCK_TOKEN, "math", 0);
  token.content = content.trim();
  token.markup = "$$";
  token.block = true;
  token.map = [startLine, lastLine + 1];
  state.line = lastLine + 1;
  return true;
}

/** Registers TeX math parsing on a markdown-it parser and returns it. */
export function applyMath<T extends MarkdownItWithRulers>(parser: T): T {
  // Before `escape`, so a `\` inside a formula is TeX rather than a markdown
  // escape, and before `fence` so an indented `$$` is not read as code.
  parser.inline.ruler.before("escape", "otto_math_inline", mathInlineRule);
  parser.block.ruler.before("fence", "otto_math_block", mathBlockRule, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  return parser;
}
