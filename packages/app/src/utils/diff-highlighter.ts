import { highlightCode, isLanguageSupported, type HighlightToken } from "@otto-code/highlight";

export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  lineNumber?: number; // Line number in the original/new file
  tokens?: HighlightToken[];
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface ParsedDiffFile {
  path: string;
  isNew: boolean;
  isDeleted: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

const DIFF_METADATA_PREFIXES = ["index ", "--- ", "+++ ", "new file mode", "deleted file mode"];

function isDiffMetadataLine(line: string): boolean {
  return DIFF_METADATA_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/**
 * Which prefix a patch header carries is the author's configuration, not a constant:
 * the default `a/` and `b/`, mnemonic `c/ i/ w/ o/` (`diff.mnemonicPrefix`), custom
 * `diff.srcPrefix`/`dstPrefix`, or none (`diff.noprefix`). Otto pins its own git reads,
 * but a patch from an agent, a forge, or a paste arrives however its author's git emits
 * it, so the prefix is derived here instead of assumed. Everything below stays a pure
 * function of the header, and a header that resists it falls through to "unknown"
 * rather than to a guess.
 */
function stripLeadingSegment(value: string): string | null {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }
  return value.slice(separator + 1);
}

/**
 * The path both sides of a header agree on. Whatever prefix pair git applied is
 * exactly what makes the two sides differ, so a shared remainder after dropping one
 * leading segment is the real path. Equal sides mean no prefix at all.
 */
function resolveSharedHeaderPath(oldPath: string, newPath: string): string | null {
  if (oldPath === newPath) {
    return oldPath;
  }
  const oldRest = stripLeadingSegment(oldPath);
  return oldRest !== null && oldRest === stripLeadingSegment(newPath) ? oldRest : null;
}

/**
 * `diff --git <old> <new>` leaves spaces unquoted, so the split between the two
 * sides is ambiguous. Every candidate split is tried and the first one whose sides
 * agree on a path wins.
 */
function resolveDiffGitHeaderPath(firstLine: string): string | null {
  for (
    let separator = firstLine.indexOf(" ");
    separator !== -1;
    separator = firstLine.indexOf(" ", separator + 1)
  ) {
    const path = resolveSharedHeaderPath(
      firstLine.slice(0, separator),
      firstLine.slice(separator + 1),
    );
    if (path) {
      return path;
    }
  }
  return null;
}

/** Renames and copies carry the one prefix-free path pair git ever emits. */
function extractRenameTargetPath(lines: string[]): string | null {
  for (const prefix of ["rename to ", "copy to "]) {
    const line = lines.find((candidate) => candidate.startsWith(prefix));
    if (line) {
      const path = line.slice(prefix.length).trimEnd();
      if (path) {
        return path;
      }
    }
  }
  return null;
}

function extractPathFromMetadata(lines: string[], prefix: "--- " | "+++ "): string | null {
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  if (!line) {
    return null;
  }

  const path = line.slice(prefix.length).replace(/\t.*$/, "").trimEnd();
  return path === "/dev/null" ? null : path;
}

function extractDiffPath(lines: string[]): string {
  const renameTarget = extractRenameTargetPath(lines);
  if (renameTarget) {
    return renameTarget;
  }

  const headerPath = resolveDiffGitHeaderPath(lines[0] ?? "");
  if (headerPath) {
    return headerPath;
  }

  const oldMetadataPath = extractPathFromMetadata(lines, "--- ");
  const newMetadataPath = extractPathFromMetadata(lines, "+++ ");
  if (oldMetadataPath && newMetadataPath) {
    const sharedMetadataPath = resolveSharedHeaderPath(oldMetadataPath, newMetadataPath);
    if (sharedMetadataPath) {
      return sharedMetadataPath;
    }
  }

  const metadataPath = newMetadataPath ?? oldMetadataPath;
  if (metadataPath) {
    return metadataPath;
  }

  return "unknown";
}

function pushContentLine(hunk: DiffHunk, line: string): { addition: number; deletion: number } {
  if (line.startsWith("+")) {
    hunk.lines.push({ type: "add", content: line.slice(1) });
    return { addition: 1, deletion: 0 };
  }
  if (line.startsWith("-")) {
    hunk.lines.push({ type: "remove", content: line.slice(1) });
    return { addition: 0, deletion: 1 };
  }
  if (line.startsWith(" ")) {
    hunk.lines.push({ type: "context", content: line.slice(1) });
    return { addition: 0, deletion: 0 };
  }
  if (line.length > 0 && !line.startsWith("\\")) {
    hunk.lines.push({ type: "context", content: line });
  }
  return { addition: 0, deletion: 0 };
}

interface HunkParseResult {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

function parseHunks(lines: string[]): HunkParseResult {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let additions = 0;
  let deletions = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (isDiffMetadataLine(line)) continue;

    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: parseInt(hunkMatch[2] ?? "1", 10),
        newStart: parseInt(hunkMatch[3], 10),
        newCount: parseInt(hunkMatch[4] ?? "1", 10),
        lines: [{ type: "header", content: line.match(/^(@@ .+? @@)/)?.[1] ?? line }],
      };
      continue;
    }

    if (!currentHunk) continue;

    const delta = pushContentLine(currentHunk, line);
    additions += delta.addition;
    deletions += delta.deletion;
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }
  return { hunks, additions, deletions };
}

/**
 * Parse a unified diff into structured data
 */
export function parseDiff(diffText: string): ParsedDiffFile[] {
  if (!diffText || diffText.trim().length === 0) {
    return [];
  }

  const files: ParsedDiffFile[] = [];
  const fileSections = diffText.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");

    const isNew = section.includes("new file mode") || section.includes("--- /dev/null");
    const isDeleted = section.includes("deleted file mode") || section.includes("+++ /dev/null");
    const path = extractDiffPath(lines);
    const { hunks, additions, deletions } = parseHunks(lines);

    files.push({ path, isNew, isDeleted, additions, deletions, hunks });
  }

  return files;
}

/**
 * Reconstruct the "new" version of a file from diff hunks.
 * Returns a map of new line numbers to their content.
 */
export function reconstructNewFile(hunks: DiffHunk[]): Map<number, string> {
  const lines = new Map<number, string>();

  for (const hunk of hunks) {
    let newLineNum = hunk.newStart;

    for (const line of hunk.lines) {
      if (line.type === "header") continue;

      if (line.type === "add" || line.type === "context") {
        lines.set(newLineNum, line.content);
        newLineNum++;
      }
      // Remove lines don't appear in the new file
    }
  }

  return lines;
}

/**
 * Reconstruct the "old" version of a file from diff hunks.
 * Returns a map of old line numbers to their content.
 */
export function reconstructOldFile(hunks: DiffHunk[]): Map<number, string> {
  const lines = new Map<number, string>();

  for (const hunk of hunks) {
    let oldLineNum = hunk.oldStart;

    for (const line of hunk.lines) {
      if (line.type === "header") continue;

      if (line.type === "remove" || line.type === "context") {
        lines.set(oldLineNum, line.content);
        oldLineNum++;
      }
      // Add lines don't appear in the old file
    }
  }

  return lines;
}

/**
 * Apply syntax highlighting to diff hunks.
 *
 * Strategy:
 * 1. Reconstruct both old and new file versions from the hunks
 * 2. Highlight each version as a complete file
 * 3. Map highlighted tokens back to diff lines using line numbers
 */
export function highlightDiffFile(file: ParsedDiffFile): ParsedDiffFile {
  if (!isLanguageSupported(file.path)) {
    return file;
  }

  // Reconstruct both versions
  const newFileLines = reconstructNewFile(file.hunks);
  const oldFileLines = reconstructOldFile(file.hunks);

  // Build complete file content strings for highlighting
  const newFileContent = buildFileContent(newFileLines);
  const oldFileContent = buildFileContent(oldFileLines);

  // Highlight both versions
  const newHighlighted = highlightCode(newFileContent, file.path);
  const oldHighlighted = highlightCode(oldFileContent, file.path);

  // Build lookup maps: line number -> tokens
  const newTokensByLine = buildTokenLookup(newFileLines, newHighlighted);
  const oldTokensByLine = buildTokenLookup(oldFileLines, oldHighlighted);

  // Apply tokens to hunks
  const highlightedHunks = file.hunks.map((hunk) => {
    let oldLineNum = hunk.oldStart;
    let newLineNum = hunk.newStart;

    const highlightedLines = hunk.lines.map((line): DiffLine => {
      if (line.type === "header") {
        return line;
      }

      let tokens: HighlightToken[] | undefined;

      if (line.type === "add") {
        tokens = newTokensByLine.get(newLineNum);
        newLineNum++;
      } else if (line.type === "remove") {
        tokens = oldTokensByLine.get(oldLineNum);
        oldLineNum++;
      } else if (line.type === "context") {
        // Context lines exist in both - use new file version
        tokens = newTokensByLine.get(newLineNum);
        oldLineNum++;
        newLineNum++;
      }

      return tokens ? { ...line, tokens } : line;
    });

    return { ...hunk, lines: highlightedLines };
  });

  return { ...file, hunks: highlightedHunks };
}

function buildFileContent(lineMap: Map<number, string>): string {
  if (lineMap.size === 0) return "";

  const lineNumbers = Array.from(lineMap.keys()).sort((a, b) => a - b);
  const minLine = lineNumbers[0];
  const maxLine = lineNumbers[lineNumbers.length - 1];

  const lines: string[] = [];
  for (let i = minLine; i <= maxLine; i++) {
    lines.push(lineMap.get(i) ?? "");
  }

  return lines.join("\n");
}

function buildTokenLookup(
  lineMap: Map<number, string>,
  highlighted: HighlightToken[][],
): Map<number, HighlightToken[]> {
  const lookup = new Map<number, HighlightToken[]>();

  if (lineMap.size === 0) return lookup;

  const lineNumbers = Array.from(lineMap.keys()).sort((a, b) => a - b);
  const minLine = lineNumbers[0];

  // highlighted array is 0-indexed, line numbers are 1-indexed
  for (let i = 0; i < highlighted.length; i++) {
    const lineNum = minLine + i;
    if (lineMap.has(lineNum)) {
      lookup.set(lineNum, highlighted[i]);
    }
  }

  return lookup;
}

/**
 * Parse and highlight a complete diff
 */
export function parseAndHighlightDiff(diffText: string): ParsedDiffFile[] {
  const files = parseDiff(diffText);
  return files.map(highlightDiffFile);
}
