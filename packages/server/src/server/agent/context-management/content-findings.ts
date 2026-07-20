/**
 * Deterministic, no-AI findings over resolved context files (charter §7.5).
 *
 * These exist because "here is the exact block to delete" is far more
 * actionable — and far more trustworthy — than "let a model rewrite your
 * rules". They ship before the AI path, not after it.
 *
 * Everything here is content comparison, so it runs as a post-pass over the
 * graph once every file has been read.
 */

import { locateFinding } from "./finding-location.js";
import type { ContextFinding, ContextNode } from "./types.js";

/** Below this, a repeated block is boilerplate (headings, `---`, "## Rules"). */
const MIN_SIGNIFICANT_BLOCK_CHARS = 60;

/**
 * The memory index convention is one line per entry, with detail living in the
 * entry file. Well past a long sentence means the entry has grown a body.
 */
const MAX_MEMORY_INDEX_LINE_CHARS = 200;

export interface ContextFileContent {
  node: ContextNode;
  text: string;
}

/** Attaches a finding to the file it was found in, stamped with where it is. */
function push(file: ContextFileContent, finding: ContextFinding): void {
  file.node.findings.push(locateFinding({ finding, nodeId: file.node.id, text: file.text }));
}

/** Blank-line separated blocks, normalized for comparison but position-tracked. */
interface Block {
  normalized: string;
  raw: string;
  start: number;
  end: number;
}

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const pattern = /(^|\n)\s*\n/g;
  let cursor = 0;
  const pushBlock = (start: number, end: number): void => {
    const raw = text.slice(start, end);
    const normalized = normalizeBlock(raw);
    if (normalized.length >= MIN_SIGNIFICANT_BLOCK_CHARS) {
      blocks.push({ normalized, raw, start, end });
    }
  };
  for (const match of text.matchAll(pattern)) {
    const boundary = match.index ?? 0;
    pushBlock(cursor, boundary);
    cursor = boundary + match[0].length;
  }
  pushBlock(cursor, text.length);
  return blocks;
}

/**
 * Whitespace-collapsed and case-folded, so reflowed or re-indented copies of
 * the same rule still match. Markdown list markers are kept: "- Always X" and
 * "Always X" are different enough to be worth not merging.
 */
function normalizeBlock(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

function firstLine(raw: string): string {
  const line = raw.trim().split("\n")[0] ?? "";
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

/**
 * The same rule present in both a global and a project context file is billed
 * twice on every request, and users almost never know they are doing it.
 */
function collectCrossScopeDuplicates(files: readonly ContextFileContent[]): void {
  const blocksByNormalized = new Map<string, { file: ContextFileContent; block: Block }[]>();

  for (const file of files) {
    if (file.node.costClass !== "fixed") continue;
    for (const block of splitBlocks(file.text)) {
      const existing = blocksByNormalized.get(block.normalized);
      if (existing) {
        existing.push({ file, block });
      } else {
        blocksByNormalized.set(block.normalized, [{ file, block }]);
      }
    }
  }

  for (const occurrences of blocksByNormalized.values()) {
    if (occurrences.length < 2) continue;
    const distinctNodes = new Map(
      occurrences.map((entry) => [entry.file.node.id, entry.file.node]),
    );
    if (distinctNodes.size < 2) continue;

    const scopes = new Set([...distinctNodes.values()].map((node) => node.scope));
    // Only flag across different scopes; two project files sharing a block is
    // usually deliberate composition, not double-billing.
    if (scopes.size < 2) continue;

    const [first, ...rest] = occurrences;
    if (!first) continue;
    const otherNode = rest.find((entry) => entry.file.node.id !== first.file.node.id)?.file.node;
    if (!otherNode) continue;

    push(first.file, {
      kind: "duplicate_across_scope",
      message: `"${firstLine(first.block.raw)}" also appears in ${otherNode.relPath} — it is sent twice`,
      range: { start: first.block.start, end: first.block.end },
      relatedNodeIds: [otherNode.id],
    });
  }
}

/** The same block twice in one file is pure waste, with no ambiguity at all. */
function collectWithinFileDuplicates(file: ContextFileContent): void {
  const seen = new Map<string, Block>();
  for (const block of splitBlocks(file.text)) {
    const previous = seen.get(block.normalized);
    if (!previous) {
      seen.set(block.normalized, block);
      continue;
    }
    push(file, {
      kind: "duplicate_within_file",
      message: `"${firstLine(block.raw)}" is repeated in this file`,
      range: { start: block.start, end: block.end },
    });
  }
}

/**
 * The memory index rides every request; entries are recalled on demand. An
 * index line that has grown into a paragraph is paying entry-sized cost for
 * index-sized value.
 */
function collectOversizedMemoryLines(file: ContextFileContent): void {
  if (file.node.category !== "memory_index") return;
  let offset = 0;
  for (const line of file.text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > MAX_MEMORY_INDEX_LINE_CHARS) {
      push(file, {
        kind: "oversized_memory_entry",
        message: `Index line is ${trimmed.length} characters — the convention is one line per entry, with detail in the entry file`,
        range: { start: offset, end: offset + line.length },
      });
    }
    offset += line.length + 1;
  }
}

/**
 * Runs every content check and appends findings onto the nodes themselves.
 * Mutates rather than returning, so a finding always travels with the file it
 * belongs to.
 */
export function collectContentFindings(files: readonly ContextFileContent[]): void {
  for (const file of files) {
    collectWithinFileDuplicates(file);
    collectOversizedMemoryLines(file);
  }
  collectCrossScopeDuplicates(files);
}

/** Convenience for callers that want the flat list after the pass has run. */
export function flattenFindings(nodes: readonly ContextNode[]): ContextFinding[] {
  return nodes.flatMap((node) => node.findings);
}
