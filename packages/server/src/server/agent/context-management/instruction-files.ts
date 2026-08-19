/**
 * Loads a workspace's instruction files for the providers whose request Otto
 * builds itself.
 *
 * Every CLI-backed provider does this in its own process: Claude reads its
 * `CLAUDE.md` chain, Codex and OpenCode merge `AGENTS.md` from their config dir
 * down to the working directory. The OpenAI-compatible family has no process of
 * its own to do it, so before this module a local model started every session
 * knowing nothing the repo had written down - the one provider Otto controls
 * completely was the only one with no project instructions at all.
 *
 * Two rules carry the design:
 *
 * 1. **One resolver, two readings.** The file set comes from
 *    `scanContextGraph`, the same function the Context Management tab reports
 *    from. A separate walk here would drift from the tab within a release and
 *    the tab would start lying about what the session carries. The report's
 *    `confidence: "exact"` is only honest because this is not a second
 *    implementation.
 * 2. **Imports are inlined; links are not.** `@path` is force-loaded,
 *    recursively, and its weight is real. `[text](path)` costs the link text
 *    and nothing more - the model reads it with a file tool if it wants it.
 *    That split is `markdown-refs.ts`, and the "Always load / Link only"
 *    control in the tab flips one edge between the two.
 *
 * Two entry points, one resolver. `loadInstructionFiles` is the fixed chain the
 * session starts with: `$OTTO_HOME/AGENTS.md`, the project root, and every
 * directory down to cwd. `loadSubdirectoryInstructionFile` is one conditional
 * file from below cwd, read when the tool loop reports that the agent has
 * started working in that subtree
 * (`providers/openai-compat-subtree-instructions.ts`). Both go through
 * `scanContextGraph`, so a subdirectory file's `@imports` are inlined by the
 * same walk, with the same cycle guard and the same depth cap, as the root's.
 */

import fs from "node:fs/promises";
import type { Logger } from "pino";
import { scanContextGraph } from "./context-graph-scanner.js";
import {
  getProviderConvention,
  OPENAI_COMPAT_CONTEXT_FAMILY,
  resolveSubdirectoryLoadPoint,
  type ContextResolutionInput,
} from "./provider-conventions.js";
import type { ContextFileContent } from "./content-findings.js";
import type { ContextCostClass } from "./types.js";

export interface LoadInstructionFilesInput extends ContextResolutionInput {
  logger?: Logger;
}

export interface LoadSubdirectoryInstructionFileInput extends LoadInstructionFilesInput {
  /** Absolute directory below cwd whose own instruction file to read. */
  dir: string;
}

export interface LoadedInstructionFiles {
  /** Prompt-ready text, or null when the workspace has no instruction files. */
  text: string | null;
  /** Absolute paths actually read, in the order they were inlined. */
  paths: string[];
}

const EMPTY: LoadedInstructionFiles = { text: null, paths: [] };

/**
 * A file's contents, headed by the path it came from.
 *
 * The header is not decoration. Imports are appended after their parent rather
 * than spliced in at the `@` token, so without a path on each block a model
 * reading a stack of instruction files cannot tell whose rule it is looking at
 * - and "the AGENTS.md in packages/app says X" is a thing agents are routinely
 * asked to reason about. Position carries no meaning here; the header does.
 */
function renderBlock(relPath: string, text: string): string | null {
  const body = text.trim();
  if (body.length === 0) return null;
  return `<instructions path="${relPath}">\n${body}\n</instructions>`;
}

/**
 * The prompt-ready blocks for the context files of one cost class, in load
 * order.
 *
 * Shared by both entry points so the fixed chain and a conditional subdirectory
 * file are rendered identically - same header, same trimming, same skip of an
 * empty file. A model must not be able to tell from the text whether a rule
 * arrived at spawn or mid-session; only *when* it arrived differs.
 */
function collectBlocks(
  contents: readonly ContextFileContent[],
  costClass: ContextCostClass,
): LoadedInstructionFiles {
  const blocks: string[] = [];
  const paths: string[] = [];
  for (const { node, text } of contents) {
    if (node.costClass !== costClass) continue;
    if (node.category !== "context_files") continue;
    const block = renderBlock(node.relPath, text);
    if (!block) continue;
    blocks.push(block);
    paths.push(node.path);
  }
  if (blocks.length === 0) return EMPTY;
  return { text: blocks.join("\n\n"), paths };
}

/**
 * Resolve and read the instruction files for one workspace.
 *
 * Never throws: a session that cannot read a context file is a session with
 * less context, not a session that fails to start. Failures are logged and the
 * prompt is built from whatever did resolve.
 *
 * A workspace whose instruction files have not changed is served from
 * `InstructionFileCache` - see the note there for why an mtime stamp and not a
 * TTL.
 */
export async function loadInstructionFiles(
  input: LoadInstructionFilesInput,
): Promise<LoadedInstructionFiles> {
  const { logger, ...resolution } = input;
  const key = cacheKey(resolution);
  const cached = key === null ? null : await cache.read(key);
  if (cached) return cached;

  try {
    const scan = await scanContextGraph(OPENAI_COMPAT_CONTEXT_FAMILY, resolution, {
      ownsContextPayload: true,
      fixedOnly: true,
      includeText: true,
    });

    // `fixedOnly` already excludes the roster and the subdirectory sweep; the
    // cost-class filter keeps the loader correct if either ever returns.
    const loaded = collectBlocks(scan.contents ?? [], "fixed");
    // Everything that decided this answer: the files that were read, and the
    // ones whose absence decided just as much.
    if (key !== null) await cache.write(key, loaded, [...loaded.paths, ...scan.absentPaths]);
    return loaded;
  } catch (error) {
    logger?.warn({ err: error, cwd: input.cwd }, "Failed to load instruction files");
    return EMPTY;
  }
}

/**
 * Read one subdirectory's instruction file, imports inlined, for the tool loop
 * to inject once the agent starts working there.
 *
 * The load point comes from `resolveSubdirectoryLoadPoint`, which is also what
 * the tab's conditional sweep reads: one directory, one slot, `AGENTS.md` with
 * `CLAUDE.md` as the per-directory fallback. Handing the scanner an explicit
 * load point (rather than a second walk here) is what keeps the injected file
 * and the reported row the same file.
 *
 * Deliberately uncached, unlike the fixed chain: the session injects a given
 * directory once and then remembers it in the conversation itself, so a cache
 * would hold entries nobody reads twice.
 *
 * Never throws - a subtree whose instructions cannot be read is a subtree
 * without extra rules, not a failed tool call.
 */
export async function loadSubdirectoryInstructionFile(
  input: LoadSubdirectoryInstructionFileInput,
): Promise<LoadedInstructionFiles> {
  const { logger, dir, ...resolution } = input;
  try {
    const convention = getProviderConvention(OPENAI_COMPAT_CONTEXT_FAMILY, {
      ownsContextPayload: true,
    });
    const loadPoint = convention ? resolveSubdirectoryLoadPoint(convention, dir) : null;
    if (!loadPoint) return EMPTY;

    const scan = await scanContextGraph(OPENAI_COMPAT_CONTEXT_FAMILY, resolution, {
      ownsContextPayload: true,
      loadPoints: [loadPoint],
      includeText: true,
    });
    return collectBlocks(scan.contents ?? [], "conditional");
  } catch (error) {
    logger?.warn({ err: error, dir: input.dir }, "Failed to load subdirectory instruction file");
    return EMPTY;
  }
}

interface WatchStamp {
  /** Identity of every watched path, in the order they were given. */
  stamp: string;
  /** Newest mtime across the set, for the settle check. */
  newestMtimeMs: number;
}

/**
 * Stamp every path whose content or existence fed the answer.
 *
 * `mtimeMs` alone is not quite enough - a filesystem with coarse timestamps can
 * round two writes into the same value - so the size rides along. The remaining
 * hole (same timestamp, same size, different bytes) is closed by
 * `MTIME_SETTLE_MS`.
 */
async function stampWatchedPaths(watched: string[]): Promise<WatchStamp> {
  const stamped = await Promise.all(
    watched.map(async (filePath) => {
      try {
        const stats = await fs.stat(filePath);
        return {
          mtimeMs: stats.mtimeMs,
          line: `${filePath}\u0000${stats.mtimeMs}\u0000${stats.size}`,
        };
      } catch {
        // Absent is a state like any other, and the one that must be noticed
        // when it ends: this is the entry that catches an `AGENTS.md` appearing
        // where the scan found none.
        return { mtimeMs: 0, line: `${filePath}\u0000absent` };
      }
    }),
  );
  return {
    stamp: stamped.map((entry) => entry.line).join("\n"),
    newestMtimeMs: stamped.reduce((newest, entry) => Math.max(newest, entry.mtimeMs), 0),
  };
}

interface CacheEntry {
  loaded: LoadedInstructionFiles;
  /** Watched paths in the order the stamp was built from - the order is part of it. */
  watched: string[];
  stamp: string;
}

/**
 * A file written this recently is not stamped reliably yet, so its workspace is
 * not cached at all.
 *
 * Two holes, one guard. A filesystem with coarse timestamps can give two writes
 * the same `mtimeMs`; and a write landing *during* a scan would be stamped with
 * an mtime that already matches the text read just before it, pinning stale
 * bytes for as long as nobody touches the file again. Both need the file to
 * have been written moments ago, and both cost only a cache miss - which is the
 * trade this cache is allowed to make, in the direction it is allowed to make
 * it.
 */
const MTIME_SETTLE_MS = 2_000;

/** Workspaces are few; the cap only stops a long-lived daemon from growing. */
const MAX_CACHE_ENTRIES = 32;

/**
 * Instruction text keyed by workspace, invalidated by mtime.
 *
 * **Why not the 15 second TTL `ContextManagementService` uses.** That cache
 * holds a *report*, and its inputs include the live system prompt and tool
 * schemas, which no file stamp can describe; being 15 seconds behind shows a
 * number slightly out of date in a panel. This cache holds the bytes that
 * become the session's rules, where a stale hit silently reverts an edit to
 * `AGENTS.md` - the exact failure that keeps this loading runtime-only rather
 * than baked into the stored agent config. Different value, different inputs,
 * and a different cost of being wrong, so deliberately not the same mechanism.
 * What the two do share is `scanContextGraph`: still one resolver, and both
 * still read through it.
 *
 * Correctness over hit rate throughout. Every path that fed the answer is
 * re-stat-ed on the way in, any mismatch at all is a miss, and a result that
 * cannot be stamped confidently is never stored.
 */
class InstructionFileCache {
  private readonly entries = new Map<string, CacheEntry>();

  async read(key: string): Promise<LoadedInstructionFiles | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;

    const { stamp } = await stampWatchedPaths(entry.watched);
    if (stamp !== entry.stamp) {
      this.entries.delete(key);
      return null;
    }

    // Re-insert so the cap evicts the least recently used workspace.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.loaded;
  }

  async write(key: string, loaded: LoadedInstructionFiles, watched: string[]): Promise<void> {
    const { stamp, newestMtimeMs } = await stampWatchedPaths(watched);
    if (Date.now() - newestMtimeMs < MTIME_SETTLE_MS) {
      this.entries.delete(key);
      return;
    }

    this.entries.set(key, { loaded, watched, stamp });
    while (this.entries.size > MAX_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

const cache = new InstructionFileCache();

/** Tests only: temp workspaces get reused, and must not answer from a dead one. */
export function clearInstructionFileCache(): void {
  cache.clear();
}

/**
 * The workspace's identity, taken as the set of files its convention would look
 * at.
 *
 * `resolveLoadPoints` is pure path arithmetic, so this costs nothing and stays
 * correct for free: cwd, project root and `$OTTO_HOME` reach the answer only
 * through it, and a convention that starts reading some other environment
 * variable is keyed on it without this function having to learn about it.
 * `homeDir` is keyed separately because it also decides the `~/…` display path
 * that heads a block.
 */
function cacheKey(resolution: ContextResolutionInput): string | null {
  const convention = getProviderConvention(OPENAI_COMPAT_CONTEXT_FAMILY, {
    ownsContextPayload: true,
  });
  if (!convention) return null;
  const parts = [resolution.homeDir];
  for (const point of convention.resolveLoadPoints(resolution)) {
    parts.push(point.path);
    if (point.fallbackPaths) parts.push(...point.fallbackPaths);
  }
  return parts.join("\u0000");
}
