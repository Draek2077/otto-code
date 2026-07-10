import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { getParserForFile } from "./parsers.js";

// ctags-style symbol extraction. It reuses the same Lezer parse trees the
// highlighter walks, but with a highlighter keyed only to *definition*-flavored
// tags — so it captures declarations (a function, class, const, type) rather
// than every reference. Name-based and honest: no type resolution, and a
// grammar that doesn't tag a construct as a definition simply won't surface it.

export type SymbolKind = "function" | "class" | "type" | "variable" | "property";

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based line of the identifier. */
  line: number;
  /** 1-based column of the identifier. */
  column: number;
}

// Order matters: more specific tags are listed first so a function definition
// is classified as "function", not the broader "variable".
const definitionHighlighter = tagHighlighter([
  { tag: tags.definition(tags.function(tags.variableName)), class: "function" },
  { tag: tags.function(tags.definition(tags.variableName)), class: "function" },
  { tag: tags.definition(tags.className), class: "class" },
  { tag: tags.definition(tags.propertyName), class: "property" },
  { tag: tags.definition(tags.variableName), class: "variable" },
  { tag: tags.definition(tags.typeName), class: "type" },
  { tag: tags.className, class: "class" },
  { tag: tags.typeName, class: "type" },
]);

const CLASS_TO_KIND: Record<string, SymbolKind> = {
  function: "function",
  class: "class",
  type: "type",
  variable: "variable",
  property: "property",
};

function buildLineStarts(code: string): number[] {
  const starts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

// Binary search for the 0-based line index whose start is <= offset.
function lineIndexForOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Extract definition symbols from source. Returns [] for unsupported
 * languages (there is no parser) rather than throwing.
 */
export function extractSymbols(code: string, filename: string): CodeSymbol[] {
  const parser = getParserForFile(filename);
  if (!parser) {
    return [];
  }
  const tree = parser.parse(code);
  const lineStarts = buildLineStarts(code);
  const symbols: CodeSymbol[] = [];
  const seen = new Set<string>();

  highlightTree(tree, definitionHighlighter, (from, to, classes) => {
    const kind = CLASS_TO_KIND[classes];
    if (!kind) {
      return;
    }
    const name = code.slice(from, to);
    // Highlight ranges can cover punctuation or multi-token spans; keep only
    // clean identifiers so the index stays name-addressable.
    if (!IDENTIFIER.test(name)) {
      return;
    }
    const lineIndex = lineIndexForOffset(lineStarts, from);
    const dedupeKey = `${name} ${lineIndex} ${kind}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    symbols.push({
      name,
      kind,
      line: lineIndex + 1,
      column: from - lineStarts[lineIndex] + 1,
    });
  });

  symbols.sort((a, b) => a.line - b.line || a.column - b.column);
  return symbols;
}
