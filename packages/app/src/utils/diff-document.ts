import type { DiffLine } from "@/utils/tool-call-parsers";
import { getParserForFile } from "@otto-code/highlight";
import type { SyntaxNode, Tree } from "@lezer/common";
import type { ParsedDiffFile } from "@otto-code/protocol/messages";
import { buildNumberedDiffHunks, type ReviewableDiffTarget } from "@/utils/diff-layout";

/**
 * The renderer-facing diff representation.  Sources are deliberately reduced
 * to the same sequence before any layout is chosen: a Git patch, an agent edit
 * and a Refine proposal therefore cannot grow their own pairing algorithm.
 */
export interface DiffDocument {
  lines: readonly DiffLine[];
  filePath?: string | null;
  source: "patch" | "before-after" | "proposal" | "agent-edit";
  /** Whole snapshots are optional while patch-only surfaces are migrated. */
  beforeSource?: string | null;
  afterSource?: string | null;
  /**
   * Real patch hunks and review targets, when the source surface provides
   * them. Structural rendering must preserve this instead of flattening it.
   */
  hunks?: readonly DiffDocumentHunk[];
}

export interface DiffDocumentLine {
  key: string;
  hunkIndex: number;
  hunkHeader: string;
  lineIndex: number;
  line: DiffLine;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  oldReviewTarget: ReviewableDiffTarget | null;
  newReviewTarget: ReviewableDiffTarget | null;
}

export interface DiffDocumentHunk {
  index: number;
  header: string;
  lines: readonly DiffDocumentLine[];
}

/**
 * Source-pair and compact patch callers do not arrive with protocol hunks, but
 * their real old/new coordinates still define an honest review location.
 */
export function createDiffDocumentHunksFromLines(
  lines: readonly DiffLine[],
): readonly DiffDocumentHunk[] {
  const visibleLines = lines.filter((line) => line.type !== "header");
  if (visibleLines.length === 0) return [];
  const oldLineNumbers = visibleLines.flatMap((line) =>
    line.oldLineNumber === undefined ? [] : [line.oldLineNumber],
  );
  const newLineNumbers = visibleLines.flatMap((line) =>
    line.newLineNumber === undefined ? [] : [line.newLineNumber],
  );
  if (oldLineNumbers.length === 0 && newLineNumbers.length === 0) return [];
  const oldStart = oldLineNumbers[0] ?? 0;
  const newStart = newLineNumbers[0] ?? 0;
  return [
    {
      index: 0,
      header: `@@ -${oldStart},${oldLineNumbers.length} +${newStart},${newLineNumbers.length} @@`,
      lines: visibleLines.map((line, lineIndex) => ({
        key: `source-pair:${lineIndex}`,
        hunkIndex: 0,
        hunkHeader: `@@ -${oldStart},${oldLineNumbers.length} +${newStart},${newLineNumbers.length} @@`,
        lineIndex,
        line,
        oldLineNumber: line.oldLineNumber ?? null,
        newLineNumber: line.newLineNumber ?? null,
        oldReviewTarget: null,
        newReviewTarget: null,
      })),
    },
  ];
}

/**
 * Adapts the live checkout payload without dropping hunk boundaries, syntax
 * tokens, old/new coordinates, or stable review targets.
 */
export function createDiffDocumentFromParsedFile(file: ParsedDiffFile): DiffDocument {
  const hunks = buildNumberedDiffHunks(file).map((hunk) => ({
    index: hunk.hunkIndex,
    header: hunk.hunkHeader,
    lines: hunk.lines.map((numberedLine): DiffDocumentLine => {
      const line: DiffLine = {
        ...numberedLine.line,
        ...(numberedLine.oldLineNumber === null
          ? {}
          : { oldLineNumber: numberedLine.oldLineNumber }),
        ...(numberedLine.newLineNumber === null
          ? {}
          : { newLineNumber: numberedLine.newLineNumber }),
      };
      return {
        key: numberedLine.key,
        hunkIndex: numberedLine.hunkIndex,
        hunkHeader: numberedLine.hunkHeader,
        lineIndex: numberedLine.lineIndex,
        line,
        oldLineNumber: numberedLine.oldLineNumber,
        newLineNumber: numberedLine.newLineNumber,
        oldReviewTarget: numberedLine.oldCell,
        newReviewTarget: numberedLine.newCell,
      };
    }),
  }));
  return {
    source: "patch",
    filePath: file.path,
    beforeSource: file.beforeSource,
    afterSource: file.afterSource,
    hunks,
    lines: hunks.flatMap((hunk) => hunk.lines.map((line) => line.line)),
  };
}

export type DiffPresentation = "line" | "structural";

export type StructuralAvailability =
  | { available: true }
  | {
      available: false;
      code: "large-diff" | "unsupported-language" | "missing-source" | "invalid-source";
      message: string;
    };

export type StructuralDiffRow =
  | { kind: "header"; content: string }
  | { kind: "pair"; left: DiffLine | null; right: DiffLine | null };

/**
 * Parser-derived context for a source line. It intentionally records only a
 * named-node path, rather than grammar-specific AST data, so every language
 * in the syntax registry can participate without a second parser matrix.
 */
export interface StructuralSourceIndex {
  readonly contexts: ReadonlyMap<number, readonly string[]>;
}

/**
 * Presentation-neutral semantic blocks. Renderers choose whether a small
 * replacement is compact or shown as explicit before/after text; they do not
 * need to rediscover the kind of change from raw patch lines.
 */
export type StructuralDiffBlock =
  | { kind: "header"; lines: readonly DiffLine[] }
  | { kind: "shared"; lines: readonly DiffLine[] }
  | { kind: "replacement"; before: readonly DiffLine[]; after: readonly DiffLine[] }
  | { kind: "formatting"; before: readonly DiffLine[]; after: readonly DiffLine[] }
  | { kind: "addition"; lines: readonly DiffLine[] }
  | { kind: "removal"; lines: readonly DiffLine[] }
  | { kind: "move"; direction: "from" | "to"; lines: readonly DiffLine[] };

const MAX_STRUCTURAL_LINES = 2_000;
const WHITESPACE_SIGNIFICANT_EXTENSIONS = new Set([
  "py",
  "yaml",
  "yml",
  "md",
  "mdx",
  "sh",
  "bash",
  "zsh",
  "shell",
]);

/** The parse tree for a snapshot, or null when the language or source is unusable. */
function parseWithoutError(source: string, filePath: string): Tree | null {
  const parser = getParserForFile(filePath);
  if (!parser) return null;
  const tree = parser.parse(source);
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) return null;
  } while (cursor.next());
  return tree;
}

function lineStarts(source: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function namedNodePath(node: SyntaxNode): readonly string[] {
  const path: string[] = [];
  for (let current: SyntaxNode | null = node; current !== null; current = current.parent) {
    const name = current.type.name;
    // Top-level and anonymous token nodes don't distinguish one changed line
    // from another. The remaining path is stable across parser snapshots.
    if (name && name !== "Script" && name !== "Program" && name !== "Document") {
      path.push(name);
    }
  }
  return path.toReversed().slice(-6);
}

function computeStructuralSourceIndex(
  source: string,
  filePath: string,
): StructuralSourceIndex | null {
  const tree = parseWithoutError(source, filePath);
  if (!tree) return null;
  const starts = lineStarts(source);
  const contexts = new Map<number, readonly string[]>();

  starts.forEach((start, index) => {
    const end = starts[index + 1] ?? source.length;
    const content = source.slice(start, end);
    const firstContentOffset = content.search(/\S/);
    if (firstContentOffset < 0) return;
    contexts.set(index + 1, namedNodePath(tree.resolveInner(start + firstContentOffset, 1)));
  });

  return { contexts };
}

interface StructuralSourceIndexEntry {
  filePath: string;
  source: string;
  index: StructuralSourceIndex | null;
}

/**
 * Parsing a whole file is the single most expensive step here, and the callers
 * ask for the same two snapshots repeatedly: once per hunk for the render plan,
 * and again for the availability check. Keeping the last few results makes those
 * repeats free while staying trivially bounded - a viewer only ever needs the
 * before and after side of the file on screen.
 */
const STRUCTURAL_SOURCE_INDEX_CACHE_LIMIT = 4;
const structuralSourceIndexCache: StructuralSourceIndexEntry[] = [];

/**
 * Builds source-line syntax context from a complete, parser-safe snapshot.
 * Patch hunks never go through this function: parser positions only mean
 * something against the original whole file.
 */
export function buildStructuralSourceIndex(
  source: string | null | undefined,
  filePath: string | null | undefined,
): StructuralSourceIndex | null {
  if (!source || !filePath) return null;
  const cached = structuralSourceIndexCache.find(
    (entry) => entry.filePath === filePath && entry.source === source,
  );
  if (cached) return cached.index;
  const index = computeStructuralSourceIndex(source, filePath);
  structuralSourceIndexCache.unshift({ filePath, source, index });
  structuralSourceIndexCache.length = Math.min(
    structuralSourceIndexCache.length,
    STRUCTURAL_SOURCE_INDEX_CACHE_LIMIT,
  );
  return index;
}

export function getStructuralDiffAvailability(document: DiffDocument): StructuralAvailability {
  if (document.lines.length > MAX_STRUCTURAL_LINES) {
    return {
      available: false,
      code: "large-diff",
      message: "Structural view is unavailable for large diffs. Showing the complete Line diff.",
    };
  }
  const parser = document.filePath ? getParserForFile(document.filePath) : null;
  if (!parser) {
    return {
      available: false,
      code: "unsupported-language",
      message: "Structural view is unavailable for this file type. Showing the complete Line diff.",
    };
  }
  const hasChangedLines = document.lines.some(
    (line) => line.type === "add" || line.type === "remove",
  );
  if (
    hasChangedLines &&
    (document.beforeSource === undefined || document.afterSource === undefined)
  ) {
    return {
      available: false,
      code: "missing-source",
      message:
        "Structural view needs complete before and after source. Showing the complete Line diff.",
    };
  }
  for (const source of [document.beforeSource, document.afterSource]) {
    if (source === undefined) continue;
    if (source === null) {
      return {
        available: false,
        code: "missing-source",
        message:
          "Structural view needs complete before and after source. Showing the complete Line diff.",
      };
    }
    // Goes through the shared index so this check and the render plan parse the
    // file once between them. An empty snapshot has nothing to parse and nothing
    // to reject: a newly added file has no before side.
    if (source !== "" && buildStructuralSourceIndex(source, document.filePath) === null) {
      return {
        available: false,
        code: "invalid-source",
        message:
          "Structural view is unavailable because this source cannot be parsed safely. Showing the complete Line diff.",
      };
    }
  }
  return { available: true };
}

export function getStructuralDiffUnavailableReason(document: DiffDocument): string | null {
  const availability = getStructuralDiffAvailability(document);
  return availability.available ? null : availability.message;
}

/** Removes the patch marker without losing the original line in the model. */
export function diffCode(line: DiffLine): string {
  if (line.type === "add" || line.type === "remove" || line.type === "context") {
    let marker = " ";
    if (line.type === "add") marker = "+";
    if (line.type === "remove") marker = "-";
    return line.content.startsWith(marker) ? line.content.slice(1) : line.content;
  }
  return line.content;
}

/**
 * The lexical facts pairing needs from one line. Alignment compares every
 * removal against every addition, so deriving these per comparison meant
 * re-running the same regex passes O(removals x additions) times for values
 * that only depend on the line. They are memoized per `DiffLine` instead.
 */
interface LineSignature {
  shape: string;
  tokens: readonly string[];
  role: string | null;
}

const lineSignatures = new WeakMap<DiffLine, LineSignature>();

function structuralRole(code: string): string | null {
  const markdownHeading = /^(#{1,6})\s/.exec(code);
  if (markdownHeading) return `markdown-heading:${markdownHeading[1]!.length}`;
  const markupTag = /^<([a-z][a-z0-9:-]*)\b/i.exec(code);
  if (markupTag) return `markup:${markupTag[1]!.toLowerCase()}`;
  if (code.startsWith("//")) return "line-comment";
  if (code.startsWith("/*")) return "block-comment";
  if (/^import\s/.test(code)) return "import";
  return null;
}

function lineSignature(line: DiffLine): LineSignature {
  const cached = lineSignatures.get(line);
  if (cached) return cached;
  const code = diffCode(line);
  // This is intentionally a conservative structural heuristic, not a claim to
  // parse every grammar.  It aligns the same syntactic neighbourhood despite
  // whitespace/wrap churn and leaves unmatched rows visible on their own side.
  const withoutComments = code.replace(/\/\/.*$|#.*$/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const signature: LineSignature = {
    shape: withoutComments
      .replace(/["'`]([^"'`\\]|\\.)*["'`]/g, "str")
      .replace(/\b\d+(?:\.\d+)?\b/g, "num")
      .replace(/\s+/g, "")
      .replace(/[{}()[\],;:.]/g, "")
      .toLowerCase(),
    tokens:
      withoutComments
        .replace(/["'`]([^"'`\\]|\\.)*["'`]/g, " str ")
        .replace(/\b\d+(?:\.\d+)?\b/g, " num ")
        .toLowerCase()
        .match(/[a-z_][a-z0-9_]*/g) ?? [],
    role: structuralRole(code.trim()),
  };
  lineSignatures.set(line, signature);
  return signature;
}

function tokenSimilarity(leftTokens: readonly string[], rightTokens: readonly string[]): number {
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const remaining = new Map<string, number>();
  for (const token of leftTokens) {
    remaining.set(token, (remaining.get(token) ?? 0) + 1);
  }
  let shared = 0;
  for (const token of rightTokens) {
    const count = remaining.get(token) ?? 0;
    if (count === 0) continue;
    shared += 1;
    remaining.set(token, count - 1);
  }
  return shared / Math.max(leftTokens.length, rightTokens.length);
}

function similarity(left: LineSignature, right: LineSignature): number {
  const a = left.shape;
  const b = right.shape;
  const sameRole = left.role !== null && left.role === right.role;
  if (!a || !b) return sameRole ? 0.6 : 0;
  if (a === b) return 1;
  let common = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) common += 1;
  }
  const positionalSimilarity = common / Math.max(a.length, b.length);
  const sharedTokenSimilarity = tokenSimilarity(left.tokens, right.tokens);
  // Token overlap only raises confidence when most of the syntactic words
  // agree. That pairs a changed import source but does not collapse an old
  // CommonJS import into an unrelated ES-module import.
  return sameRole || sharedTokenSimilarity >= 0.6
    ? Math.max(positionalSimilarity, sharedTokenSimilarity, sameRole ? 0.6 : 0)
    : positionalSimilarity;
}

interface StructuralPairingEvidence {
  before: StructuralSourceIndex | null;
  after: StructuralSourceIndex | null;
}

function sharedContextSuffix(left: readonly string[], right: readonly string[]): number {
  let count = 0;
  while (
    count < left.length &&
    count < right.length &&
    left[left.length - count - 1] === right[right.length - count - 1]
  ) {
    count += 1;
  }
  return count;
}

function parserContextSimilarity(
  removal: DiffLine,
  addition: DiffLine,
  evidence: StructuralPairingEvidence | undefined,
): number {
  const oldLineNumber = removal.oldLineNumber;
  const newLineNumber = addition.newLineNumber;
  if (!evidence || oldLineNumber === undefined || newLineNumber === undefined) return 0;
  const before = evidence.before?.contexts.get(oldLineNumber);
  const after = evidence.after?.contexts.get(newLineNumber);
  if (!before || !after) return 0;
  const common = sharedContextSuffix(before, after);
  // A shared leaf token such as VariableName isn't enough. Two named parents
  // are the minimum useful proof that these lines belong to one construct.
  return common < 2 ? 0 : common / Math.max(before.length, after.length);
}

function pairingScore(
  removal: DiffLine,
  addition: DiffLine,
  evidence: StructuralPairingEvidence | undefined,
): number {
  const base = similarity(lineSignature(removal), lineSignature(addition));
  // Parser shape disambiguates already credible candidates. It must never
  // turn unrelated lines in the same function into a claimed replacement.
  return base < 0.35 ? base : base + parserContextSimilarity(removal, addition, evidence) * 0.12;
}

/**
 * Monotonic sequence alignment prevents the crossed before/after pairs that
 * the old greedy matcher produced for repeated code. A parser-derived context
 * breaks otherwise close ties, but only after lexical structure already makes
 * the pair credible.
 */
function alignChangeBlock(
  removals: DiffLine[],
  additions: DiffLine[],
  evidence?: StructuralPairingEvidence,
): StructuralDiffRow[] {
  const scores = Array.from({ length: removals.length }, () => Array(additions.length).fill(0));
  for (let oldIndex = 0; oldIndex < removals.length; oldIndex += 1) {
    for (let newIndex = 0; newIndex < additions.length; newIndex += 1) {
      scores[oldIndex]![newIndex] = pairingScore(
        removals[oldIndex]!,
        additions[newIndex]!,
        evidence,
      );
    }
  }

  const plan = Array.from({ length: removals.length + 1 }, () =>
    Array(additions.length + 1).fill(0),
  );
  for (let oldIndex = removals.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = additions.length - 1; newIndex >= 0; newIndex -= 1) {
      const pairScore = scores[oldIndex]![newIndex]!;
      const paired =
        pairScore >= 0.35
          ? pairScore + plan[oldIndex + 1]![newIndex + 1]!
          : Number.NEGATIVE_INFINITY;
      plan[oldIndex]![newIndex] = Math.max(
        paired,
        plan[oldIndex + 1]![newIndex]!,
        plan[oldIndex]![newIndex + 1]!,
      );
    }
  }

  const rows: StructuralDiffRow[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < removals.length || newIndex < additions.length) {
    if (oldIndex === removals.length) {
      rows.push({ kind: "pair", left: null, right: additions[newIndex++]! });
      continue;
    }
    if (newIndex === additions.length) {
      rows.push({ kind: "pair", left: removals[oldIndex++]!, right: null });
      continue;
    }

    const pairScore = scores[oldIndex]![newIndex]!;
    const paired =
      pairScore >= 0.35 ? pairScore + plan[oldIndex + 1]![newIndex + 1]! : Number.NEGATIVE_INFINITY;
    const skipOld = plan[oldIndex + 1]![newIndex]!;
    const skipNew = plan[oldIndex]![newIndex + 1]!;
    if (paired >= skipOld && paired >= skipNew) {
      rows.push({
        kind: "pair",
        left: removals[oldIndex++]!,
        right: additions[newIndex++]!,
      });
    } else if (skipOld >= skipNew) {
      rows.push({ kind: "pair", left: removals[oldIndex++]!, right: null });
    } else {
      rows.push({ kind: "pair", left: null, right: additions[newIndex++]! });
    }
  }
  return rows;
}

function withoutWhitespace(lines: readonly DiffLine[]): string {
  return lines.map(diffCode).join("\n").replace(/\s/g, "");
}

function canCollapseWhitespaceOnlyChanges(filePath: string | null | undefined): boolean {
  const extension = filePath?.split(".").at(-1)?.toLowerCase();
  return extension !== undefined && !WHITESPACE_SIGNIFICANT_EXTENSIONS.has(extension);
}

/**
 * A move's removed side is hidden from the reviewer, so claiming one has to be
 * unambiguous. Two guards keep that honest:
 *
 * - the line must be distinctive. Structural punctuation like `}` or `);` is
 *   removed and added all over an ordinary diff, and treating those as moves
 *   silently erased real deletions from the review;
 * - it must appear exactly once on each side. With repeats there is no single
 *   destination to send the reviewer to, so both sides stay visible.
 */
const MIN_MOVED_LINE_TOKENS = 2;

function isDistinctiveMoveCandidate(code: string): boolean {
  return (
    code.trim().length > 0 &&
    (code.match(/[A-Za-z_][A-Za-z0-9_]*/g)?.length ?? 0) >= MIN_MOVED_LINE_TOKENS
  );
}

function movedLineCounts(lines: readonly DiffLine[]): Map<string, { from: number; to: number }> {
  const removals = new Map<string, number>();
  const additions = new Map<string, number>();
  for (const line of lines) {
    if (line.type !== "remove" && line.type !== "add") continue;
    const code = diffCode(line);
    if (!isDistinctiveMoveCandidate(code)) continue;
    const target = line.type === "remove" ? removals : additions;
    target.set(code, (target.get(code) ?? 0) + 1);
  }

  const shared = new Map<string, { from: number; to: number }>();
  for (const [code, removalCount] of removals) {
    if (removalCount !== 1 || additions.get(code) !== 1) continue;
    shared.set(code, { from: 1, to: 1 });
  }
  return shared;
}

function appendLines(
  blocks: StructuralDiffBlock[],
  kind: "header" | "shared" | "addition" | "removal",
  lines: readonly DiffLine[],
) {
  if (lines.length === 0) return;
  const previous = blocks.at(-1);
  if (previous?.kind === kind) {
    previous.lines = [...previous.lines, ...lines];
    return;
  }
  blocks.push({ kind, lines });
}

type MoveReservations = Map<string, { from: number; to: number }>;

function takeMove(reservations: MoveReservations, line: DiffLine): boolean {
  const code = diffCode(line);
  const side = line.type === "remove" ? "from" : "to";
  const remaining = reservations.get(code)?.[side] ?? 0;
  if (remaining === 0) return false;
  const record = reservations.get(code)!;
  record[side] = remaining - 1;
  return true;
}

function appendChangeBlock(
  blocks: StructuralDiffBlock[],
  removals: readonly DiffLine[],
  additions: readonly DiffLine[],
  reservations: MoveReservations,
  canCollapseWhitespace: boolean,
  evidence?: StructuralPairingEvidence,
) {
  if (removals.length === 0 && additions.length === 0) return;
  if (
    removals.length > 0 &&
    additions.length > 0 &&
    canCollapseWhitespace &&
    withoutWhitespace(removals) === withoutWhitespace(additions)
  ) {
    blocks.push({ kind: "formatting", before: removals, after: additions });
    return;
  }

  // Keep the aligned rows in source order. Grouping all replacements first made
  // a deletion appear after a replacement that it originally preceded.
  for (const row of alignChangeBlock([...removals], [...additions], evidence)) {
    if (row.kind !== "pair") continue;
    if (row.left?.type === "remove" && row.right?.type === "add") {
      blocks.push({ kind: "replacement", before: [row.left], after: [row.right] });
    } else if (row.left?.type === "remove") {
      if (takeMove(reservations, row.left)) {
        blocks.push({ kind: "move", direction: "from", lines: [row.left] });
      } else {
        appendLines(blocks, "removal", [row.left]);
      }
    } else if (row.right?.type === "add") {
      if (takeMove(reservations, row.right)) {
        blocks.push({ kind: "move", direction: "to", lines: [row.right] });
      } else {
        appendLines(blocks, "addition", [row.right]);
      }
    }
  }
}

/**
 * Builds a compact semantic plan from a complete source-pair diff. This is
 * deliberately conservative: a move is emitted only for exactly identical
 * removed and added lines, and formatting means the non-whitespace source is
 * byte-for-byte identical. Everything else remains visible as a replacement,
 * addition, or removal until a language parser can prove more.
 */
export function buildStructuralDiffBlocks(document: DiffDocument): StructuralDiffBlock[] {
  const blocks: StructuralDiffBlock[] = [];
  const remainingMoves = movedLineCounts(document.lines);
  const evidence: StructuralPairingEvidence = {
    before: buildStructuralSourceIndex(document.beforeSource, document.filePath),
    after: buildStructuralSourceIndex(document.afterSource, document.filePath),
  };
  let removals: DiffLine[] = [];
  let additions: DiffLine[] = [];
  const flush = () => {
    appendChangeBlock(
      blocks,
      removals,
      additions,
      remainingMoves,
      canCollapseWhitespaceOnlyChanges(document.filePath),
      evidence,
    );
    removals = [];
    additions = [];
  };

  for (const line of document.lines) {
    if (line.type === "remove") {
      removals.push(line);
    } else if (line.type === "add") {
      additions.push(line);
    } else {
      flush();
      if (line.type === "header") appendLines(blocks, "header", [line]);
      else appendLines(blocks, "shared", [line]);
    }
  }
  flush();
  return blocks;
}

/** Keeps the user-facing formatting preference out of the semantic planner. */
export function filterStructuralDiffBlocks(
  blocks: readonly StructuralDiffBlock[],
  showFormattingChanges: boolean,
): readonly StructuralDiffBlock[] {
  return showFormattingChanges ? blocks : blocks.filter((block) => block.kind !== "formatting");
}

/**
 * Difftastic-style presentation data. It preserves every original line while
 * pairing high-confidence corresponding fragments before unrelated additions.
 */
export function buildStructuralDiffRows(document: DiffDocument): StructuralDiffRow[] {
  const rows: StructuralDiffRow[] = [];
  const evidence: StructuralPairingEvidence = {
    before: buildStructuralSourceIndex(document.beforeSource, document.filePath),
    after: buildStructuralSourceIndex(document.afterSource, document.filePath),
  };
  let removals: DiffLine[] = [];
  let additions: DiffLine[] = [];
  const flush = () => {
    rows.push(...alignChangeBlock(removals, additions, evidence));
    removals = [];
    additions = [];
  };

  for (const line of document.lines) {
    if (line.type === "remove") {
      removals.push(line);
    } else if (line.type === "add") {
      additions.push(line);
    } else {
      flush();
      if (line.type === "header") rows.push({ kind: "header", content: line.content });
      else rows.push({ kind: "pair", left: line, right: line });
    }
  }
  flush();
  return rows;
}
