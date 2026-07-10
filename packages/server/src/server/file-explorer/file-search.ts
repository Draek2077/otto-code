import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileSearchMatch } from "../messages.js";
import {
  GitignoreStack,
  parseGitignore,
  readGitignoreRules,
  type GitignoreRule,
} from "./gitignore.js";
import { readExplorerFile, writeExplorerFile, type WriteExplorerFileResult } from "./service.js";
import { expandUserPath } from "../path-utils.js";

// Pure-JS project search: .gitignore-aware, size-capped, binary-sniffing,
// yielding to the event loop between batches. Deliberately no ripgrep — the
// constraint is nothing spawned; revisit only with performance evidence.

const MAX_FILE_SIZE_BYTES = 1_000_000;
const MAX_MATCHES_PER_FILE = 200;
const MAX_TOTAL_MATCHES = 2_000;
const MAX_SCANNED_LINE_LENGTH = 10_000;
const PREVIEW_LENGTH = 240;
const YIELD_EVERY_FILES = 25;

export interface FileSearchFileResult {
  path: string;
  hash: string;
  matches: FileSearchMatch[];
}

export interface SearchWorkspaceOptions {
  root: string;
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
  include?: string;
  exclude?: string;
  onFileResult: (result: FileSearchFileResult) => void;
  /** Flipped by the session when a newer search supersedes this one. */
  signal: { superseded: boolean };
}

export interface SearchWorkspaceOutcome {
  status: "completed" | "truncated" | "superseded";
  fileCount: number;
  matchCount: number;
}

export class InvalidSearchQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSearchQueryError";
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildSearchRegex(options: {
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
}): RegExp {
  const body = options.regexp ? options.query : escapeRegExp(options.query);
  const wrapped = options.wholeWord ? `(?<!\\w)(?:${body})(?!\\w)` : body;
  const flags = options.caseSensitive ? "g" : "gi";
  try {
    return new RegExp(wrapped, flags);
  } catch (error) {
    throw new InvalidSearchQueryError(
      error instanceof Error ? error.message : "Invalid search pattern",
    );
  }
}

// Include/exclude globs reuse the gitignore pattern grammar; a slash-less
// pattern matches basenames at any depth, exactly like a .gitignore line.
function buildFilterRule(pattern: string): GitignoreRule[] {
  return parseGitignore(pattern, "");
}

function matchesFilter(rules: GitignoreRule[], relPath: string): boolean {
  let matched = false;
  for (const rule of rules) {
    if (rule.regex.test(relPath)) {
      matched = !rule.negated;
    }
  }
  return matched;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isLikelyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);
  if (sample.length === 0) {
    return false;
  }
  let suspicious = 0;
  for (let idx = 0; idx < sample.length; idx += 1) {
    const byte = sample[idx];
    if (byte === 0) {
      return true;
    }
    if ((byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length > 0.3;
}

function buildPreview(
  line: string,
  matchIndex: number,
): { lineText: string; previewStart: number } {
  if (line.length <= PREVIEW_LENGTH) {
    return { lineText: line, previewStart: matchIndex };
  }
  const start = Math.max(0, Math.min(matchIndex - 60, line.length - PREVIEW_LENGTH));
  return { lineText: line.slice(start, start + PREVIEW_LENGTH), previewStart: matchIndex - start };
}

function collectLineMatches(line: string, lineNumber: number, regex: RegExp): FileSearchMatch[] {
  const matches: FileSearchMatch[] = [];
  regex.lastIndex = 0;
  for (let hit = regex.exec(line); hit !== null; hit = regex.exec(line)) {
    const preview = buildPreview(line, hit.index);
    matches.push({
      line: lineNumber,
      column: hit.index + 1,
      length: hit[0].length,
      lineText: preview.lineText,
      previewStart: preview.previewStart,
    });
    if (hit[0].length === 0) {
      // Zero-length matches (e.g. `a*`) would loop forever.
      regex.lastIndex += 1;
    }
    if (matches.length >= MAX_MATCHES_PER_FILE) {
      break;
    }
  }
  return matches;
}

interface WalkFrame {
  absDir: string;
  relDir: string;
}

export async function searchWorkspaceFiles(
  options: SearchWorkspaceOptions,
): Promise<SearchWorkspaceOutcome> {
  const regex = buildSearchRegex(options);
  const includeRules = options.include?.trim() ? buildFilterRule(options.include.trim()) : null;
  const excludeRules = options.exclude?.trim() ? buildFilterRule(options.exclude.trim()) : null;
  const root = await fs.realpath(expandUserPath(options.root));

  const ignore = new GitignoreStack();
  let fileCount = 0;
  let matchCount = 0;
  let scannedSinceYield = 0;
  let truncated = false;

  async function walk(frame: WalkFrame): Promise<void> {
    if (truncated || options.signal.superseded) {
      return;
    }
    ignore.pushFrame(await readGitignoreRules(frame.absDir, frame.relDir));
    try {
      let dirents;
      try {
        dirents = await fs.readdir(frame.absDir, { withFileTypes: true });
      } catch {
        return;
      }
      // Files first so shallow matches stream before deep directories.
      dirents.sort((a, b) => Number(a.isDirectory()) - Number(b.isDirectory()));
      for (const dirent of dirents) {
        if (truncated || options.signal.superseded) {
          return;
        }
        const relPath = frame.relDir ? `${frame.relDir}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
          if (dirent.name === ".git" || ignore.isIgnored(relPath, true)) {
            continue;
          }
          if (excludeRules && matchesFilter(excludeRules, relPath)) {
            continue;
          }
          await walk({ absDir: path.join(frame.absDir, dirent.name), relDir: relPath });
          continue;
        }
        if (!dirent.isFile()) {
          continue;
        }
        if (ignore.isIgnored(relPath, false)) {
          continue;
        }
        if (excludeRules && matchesFilter(excludeRules, relPath)) {
          continue;
        }
        if (includeRules && !matchesFilter(includeRules, relPath)) {
          continue;
        }
        scannedSinceYield += 1;
        if (scannedSinceYield >= YIELD_EVERY_FILES) {
          scannedSinceYield = 0;
          await new Promise((resolve) => setImmediate(resolve));
        }
        await scanFile(path.join(frame.absDir, dirent.name), relPath);
      }
    } finally {
      ignore.popFrame();
    }
  }

  async function scanFile(absPath: string, relPath: string): Promise<void> {
    let bytes: Buffer;
    try {
      const stats = await fs.stat(absPath);
      if (!stats.isFile() || stats.size > MAX_FILE_SIZE_BYTES) {
        return;
      }
      bytes = await fs.readFile(absPath);
    } catch {
      return;
    }
    if (isLikelyBinary(bytes)) {
      return;
    }
    const lines = bytes.toString("utf-8").split(/\r\n|\r|\n/);
    const matches: FileSearchMatch[] = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (line.length === 0 || line.length > MAX_SCANNED_LINE_LENGTH) {
        continue;
      }
      matches.push(...collectLineMatches(line, lineIndex + 1, regex));
      if (matches.length >= MAX_MATCHES_PER_FILE) {
        break;
      }
    }
    if (matches.length === 0) {
      return;
    }
    const capped = matches.slice(0, Math.min(matches.length, MAX_TOTAL_MATCHES - matchCount));
    if (capped.length === 0) {
      truncated = true;
      return;
    }
    fileCount += 1;
    matchCount += capped.length;
    options.onFileResult({ path: relPath, hash: sha256Hex(bytes), matches: capped });
    if (matchCount >= MAX_TOTAL_MATCHES) {
      truncated = true;
    }
  }

  await walk({ absDir: root, relDir: "" });

  if (options.signal.superseded) {
    return { status: "superseded", fileCount, matchCount };
  }
  return { status: truncated ? "truncated" : "completed", fileCount, matchCount };
}

export interface ReplaceFileInput {
  path: string;
  expectedHash: string;
  matches: Array<{ line: number; column: number; length: number }>;
}

export type ReplaceFileOutcome =
  | { status: "ok"; path: string; replacedCount: number; modifiedAt: string; hash: string }
  | { status: "skipped"; path: string; reason: string }
  | { status: "error"; path: string; message: string };

/**
 * Applies preview-approved replacements. Every file preconditions on the hash
 * the preview was built against — a changed file is skipped, never corrupted.
 * Matches are applied bottom-up so coordinates stay valid, and the whole file
 * goes through the same conditional-write path as editor saves (containment,
 * EOL preservation, atomic replace).
 */
export async function replaceInWorkspaceFiles(options: {
  root: string;
  replacement: string;
  files: ReplaceFileInput[];
}): Promise<ReplaceFileOutcome[]> {
  const results: ReplaceFileOutcome[] = [];
  for (const file of options.files) {
    results.push(await replaceInFile(options.root, options.replacement, file));
  }
  return results;
}

async function replaceInFile(
  root: string,
  replacement: string,
  file: ReplaceFileInput,
): Promise<ReplaceFileOutcome> {
  let text: string;
  let modifiedAt: string;
  try {
    const readResult = await readTextForReplace(root, file);
    if ("outcome" in readResult) {
      return readResult.outcome;
    }
    text = readResult.text;
    modifiedAt = readResult.modifiedAt;
  } catch (error) {
    return {
      status: "error",
      path: file.path,
      message: error instanceof Error ? error.message : "Failed to read file",
    };
  }

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const ordered = [...file.matches].sort((a, b) => b.line - a.line || b.column - a.column);
  for (const match of ordered) {
    const line = lines[match.line - 1];
    if (line === undefined || match.column - 1 + match.length > line.length) {
      return {
        status: "error",
        path: file.path,
        message: "Replacement coordinates no longer match the file",
      };
    }
    lines[match.line - 1] =
      line.slice(0, match.column - 1) + replacement + line.slice(match.column - 1 + match.length);
  }

  const outcome = await writeExplorerFile({
    root,
    relativePath: file.path,
    content: lines.join("\n"),
    expectedModifiedAt: modifiedAt,
    expectedHash: file.expectedHash,
  });
  return mapWriteOutcome(file, outcome);
}

async function readTextForReplace(
  root: string,
  file: ReplaceFileInput,
): Promise<{ text: string; modifiedAt: string } | { outcome: ReplaceFileOutcome }> {
  const read = await readExplorerFile({ root, relativePath: file.path });
  if (read.kind !== "text" || typeof read.content !== "string") {
    return {
      outcome: { status: "skipped", path: file.path, reason: "Not a text file" },
    };
  }
  if (read.hash !== file.expectedHash) {
    return {
      outcome: {
        status: "skipped",
        path: file.path,
        reason: "File changed since the preview",
      },
    };
  }
  return { text: read.content, modifiedAt: read.modifiedAt };
}

function mapWriteOutcome(
  file: ReplaceFileInput,
  outcome: WriteExplorerFileResult,
): ReplaceFileOutcome {
  if (outcome.status === "ok") {
    return {
      status: "ok",
      path: file.path,
      replacedCount: file.matches.length,
      modifiedAt: outcome.modifiedAt,
      hash: outcome.hash,
    };
  }
  // A write conflict here means the file changed between our read and write.
  return { status: "skipped", path: file.path, reason: "File changed since the preview" };
}
