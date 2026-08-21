import MarkdownIt from "markdown-it";

const markdownBlockParser = new MarkdownIt();

function getFenceDelimiter(line: string) {
  const match = /^( {0,3})(`{3,}|~{3,})/.exec(line);
  return match?.[2] ?? null;
}

/**
 * Does this line open a multi-line `$$ … $$` display formula?
 *
 * A blank line is what ends a block, and a formula is allowed to contain one,
 * so display math has to hold a block open the way a code fence does -
 * otherwise the two halves arrive at the renderer as two blocks, each with an
 * unclosed `$$`, and both render as literal TeX. The single-line form (`$$x$$`)
 * opens nothing: it is already complete.
 */
function opensDisplayMath(line: string): boolean {
  const match = /^ {0,3}\$\$(.*)$/.exec(line);
  if (!match) {
    return false;
  }
  return !match[1].trimEnd().endsWith("$$");
}

function closesDisplayMath(line: string): boolean {
  return line.trimEnd().endsWith("$$");
}

export function splitMarkdownBlocks(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const blocks: string[] = [];
  let currentLines: string[] = [];
  let activeFenceCharacter: "`" | "~" | null = null;
  let activeFenceLength = 0;
  let inDisplayMath = false;
  let sawBlockSeparator = false;

  const lines = text.split("\n");
  const structuralBlankLines = getStructuralBlankLines(text, lines);

  for (const [index, line] of lines.entries()) {
    const isBlankLine = line.trim().length === 0;
    const holdsBlockOpen = activeFenceCharacter !== null || inDisplayMath;

    if (isBlankLine && (holdsBlockOpen || structuralBlankLines.has(index))) {
      currentLines.push(line);
      continue;
    }

    if (isBlankLine) {
      if (currentLines.length > 0) {
        sawBlockSeparator = true;
      }
      continue;
    }

    if (!holdsBlockOpen && sawBlockSeparator) {
      blocks.push(currentLines.join("\n"));
      currentLines = [];
      sawBlockSeparator = false;
    }

    currentLines.push(line);

    if (inDisplayMath) {
      if (closesDisplayMath(line)) {
        inDisplayMath = false;
      }
      continue;
    }

    if (activeFenceCharacter === null && opensDisplayMath(line)) {
      inDisplayMath = true;
      continue;
    }

    const fenceDelimiter = getFenceDelimiter(line);
    if (!fenceDelimiter) {
      continue;
    }

    if (!activeFenceCharacter) {
      activeFenceCharacter = fenceDelimiter[0] as "`" | "~";
      activeFenceLength = fenceDelimiter.length;
      continue;
    }

    if (fenceDelimiter[0] === activeFenceCharacter && fenceDelimiter.length >= activeFenceLength) {
      activeFenceCharacter = null;
      activeFenceLength = 0;
    }
  }

  if (currentLines.length > 0) {
    blocks.push(currentLines.join("\n"));
  }

  return blocks.filter((block) => block.length > 0);
}

function getStructuralBlankLines(text: string, lines: string[]): Set<number> {
  const blankLines = new Set<number>();
  for (const token of markdownBlockParser.parse(text, {})) {
    if (token.level !== 0 || !token.map) {
      continue;
    }
    const [start, end] = token.map;
    for (let index = start; index < end - 1; index += 1) {
      if (lines[index]?.trim().length === 0) {
        blankLines.add(index);
      }
    }
  }
  return blankLines;
}
