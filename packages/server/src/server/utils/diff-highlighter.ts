import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { highlightCode, isLanguageSupported, type HighlightToken } from "@otto-code/highlight";

export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
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
  /** Complete parser-safe snapshots, when the caller can read both sides. */
  beforeSource?: string;
  afterSource?: string;
  status?: "ok" | "too_large" | "binary";
}

interface HighlightDiffWithFileContentOptions {
  oldFileContent?: string | null;
  newFileContent?: string | null;
}

// Full-file highlighting buys the parser real context, but nothing bounds the file it runs
// over: the 1 MB cap in `checkout-git.ts` bounds the *patch* text, not the file behind it. A
// one-line edit to a 1.5 MB lockfile would otherwise push ~3 MB (old side plus new side)
// through Lezer on the daemon thread on every watcher-driven refresh. Past this size the
// hunk-reconstructed tokens are close enough, and they are already computed either way.
const MAX_FULL_FILE_HIGHLIGHT_CHARS = 256 * 1024;

export function isFullFileHighlightable(fileContent: string): boolean {
  return fileContent.length <= MAX_FULL_FILE_HIGHLIGHT_CHARS;
}

interface ParseAndHighlightDiffOptions {
  getOldFileContent?: (file: ParsedDiffFile) => Promise<string | null>;
  getNewFileContent?: (file: ParsedDiffFile) => Promise<string | null>;
  /**
   * Bounds file-content reads and highlighting for callers whose callbacks use
   * scarce shared resources such as the daemon-wide Git command limiter.
   */
  maxConcurrentFiles?: number;
}

/**
 * Parse a unified diff into structured data
 */
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

function extractPathFromDiffHeader(lines: string[]): string {
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

function isMetadataLine(line: string): boolean {
  return (
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file mode") ||
    line.startsWith("deleted file mode")
  );
}

function parseHunkHeader(line: string): DiffHunk | null {
  const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!hunkMatch) return null;
  return {
    oldStart: parseInt(hunkMatch[1], 10),
    oldCount: parseInt(hunkMatch[2] ?? "1", 10),
    newStart: parseInt(hunkMatch[3], 10),
    newCount: parseInt(hunkMatch[4] ?? "1", 10),
    lines: [{ type: "header", content: line.match(/^(@@ .+? @@)/)?.[1] ?? line }],
  };
}

interface ParsedSectionBody {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

function parseSectionBody(lines: string[]): ParsedSectionBody {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let additions = 0;
  let deletions = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (isMetadataLine(line)) continue;

    const newHunk = parseHunkHeader(line);
    if (newHunk) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = newHunk;
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith("+")) {
      currentHunk.lines.push({ type: "add", content: line.slice(1) });
      additions++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ type: "remove", content: line.slice(1) });
      deletions++;
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({ type: "context", content: line.slice(1) });
    } else if (line.length > 0 && !line.startsWith("\\")) {
      currentHunk.lines.push({ type: "context", content: line });
    }
  }

  if (currentHunk) hunks.push(currentHunk);

  return { hunks, additions, deletions };
}

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
    const path = extractPathFromDiffHeader(lines);

    const { hunks, additions, deletions } = parseSectionBody(lines);

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
    }
  }

  return lines;
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

  for (let i = 0; i < highlighted.length; i++) {
    const lineNum = minLine + i;
    if (lineMap.has(lineNum)) {
      lookup.set(lineNum, highlighted[i]);
    }
  }

  return lookup;
}

function buildFullFileTokenLookup(
  fileContent: string,
  path: string,
): Map<number, HighlightToken[]> {
  const lookup = new Map<number, HighlightToken[]>();
  const highlighted = highlightCode(fileContent, path);

  for (let i = 0; i < highlighted.length; i++) {
    lookup.set(i + 1, highlighted[i]);
  }

  return lookup;
}

function buildReconstructedTokenLookups(file: ParsedDiffFile): {
  newTokensByLine: Map<number, HighlightToken[]>;
  oldTokensByLine: Map<number, HighlightToken[]>;
} {
  const newFileLines = reconstructNewFile(file.hunks);
  const oldFileLines = reconstructOldFile(file.hunks);
  const newFileContent = buildFileContent(newFileLines);
  const oldFileContent = buildFileContent(oldFileLines);
  const newHighlighted = highlightCode(newFileContent, file.path);
  const oldHighlighted = highlightCode(oldFileContent, file.path);

  return {
    newTokensByLine: buildTokenLookup(newFileLines, newHighlighted),
    oldTokensByLine: buildTokenLookup(oldFileLines, oldHighlighted),
  };
}

/**
 * Apply syntax highlighting to diff hunks using reconstructed file content.
 * This is the fallback when actual file content is not available.
 */
export function highlightDiffFromHunks(file: ParsedDiffFile): ParsedDiffFile {
  if (!isLanguageSupported(file.path)) {
    return file;
  }

  const { newTokensByLine, oldTokensByLine } = buildReconstructedTokenLookups(file);

  return applyTokensToHunks(file, newTokensByLine, oldTokensByLine);
}

/**
 * Apply syntax highlighting to diff hunks using actual file content.
 * This provides better context for the parser.
 */
export async function highlightDiffWithFileContent(
  file: ParsedDiffFile,
  cwd: string,
  options: HighlightDiffWithFileContentOptions = {},
): Promise<ParsedDiffFile> {
  if (!isLanguageSupported(file.path)) {
    return file;
  }

  const reconstructedTokens = buildReconstructedTokenLookups(file);
  let newTokensByLine = reconstructedTokens.newTokensByLine;
  let oldTokensByLine = reconstructedTokens.oldTokensByLine;

  if (
    typeof options.oldFileContent === "string" &&
    isFullFileHighlightable(options.oldFileContent)
  ) {
    oldTokensByLine = buildFullFileTokenLookup(options.oldFileContent, file.path);
  }

  if (typeof options.newFileContent === "string") {
    if (isFullFileHighlightable(options.newFileContent)) {
      newTokensByLine = buildFullFileTokenLookup(options.newFileContent, file.path);
    }
    return applyTokensToHunks(file, newTokensByLine, oldTokensByLine);
  }

  const filePath = resolve(cwd, file.path);
  try {
    const fileContent = await readFile(filePath, "utf-8");
    if (isFullFileHighlightable(fileContent)) {
      newTokensByLine = buildFullFileTokenLookup(fileContent, file.path);
    }
  } catch {
    // If file read fails (deleted file, etc.), fall back to reconstructed new-side tokens.
  }

  return applyTokensToHunks(file, newTokensByLine, oldTokensByLine);
}

function applyTokensToHunks(
  file: ParsedDiffFile,
  newTokensByLine: Map<number, HighlightToken[]>,
  oldTokensByLine: Map<number, HighlightToken[]>,
): ParsedDiffFile {
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

/**
 * Parse and highlight a complete diff, using actual file content when available.
 */
export async function parseAndHighlightDiff(
  diffText: string,
  cwd: string,
  options: ParseAndHighlightDiffOptions = {},
): Promise<ParsedDiffFile[]> {
  const files = parseDiff(diffText);

  const maxConcurrentFiles = Math.max(1, options.maxConcurrentFiles ?? files.length);
  const highlightedFiles: ParsedDiffFile[] = [];
  let nextIndex = 0;
  const highlightNextFile = async () => {
    while (nextIndex < files.length) {
      const index = nextIndex;
      nextIndex += 1;
      const file = files[index];
      const [oldFileContent, newFileContent] = await Promise.all([
        options.getOldFileContent?.(file),
        options.getNewFileContent?.(file),
      ]);
      const highlighted = await highlightDiffWithFileContent(file, cwd, {
        oldFileContent: oldFileContent ?? undefined,
        newFileContent: newFileContent ?? undefined,
      });
      // Structural alignment needs the exact complete snapshots. Retain only
      // the same bounded content we already parse for full-file highlighting,
      // so the existing checkout frame guard remains authoritative.
      highlightedFiles[index] = {
        ...highlighted,
        ...(typeof oldFileContent === "string" && isFullFileHighlightable(oldFileContent)
          ? { beforeSource: oldFileContent }
          : {}),
        ...(typeof newFileContent === "string" && isFullFileHighlightable(newFileContent)
          ? { afterSource: newFileContent }
          : {}),
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(maxConcurrentFiles, files.length) }, () => highlightNextFile()),
  );

  return highlightedFiles;
}

// Re-export types
export type { HighlightToken };
