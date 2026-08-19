/**
 * Which subtrees a tool call touched, for the daemon-owned tool loop.
 *
 * Claude Code loads a subdirectory `CLAUDE.md` lazily: the moment the agent
 * reads, edits or runs something under a directory that carries its own
 * instructions, that file joins the conversation and stays for the rest of the
 * session. The OpenAI-compatible family has no process of its own to do that,
 * so the daemon does it - this module answers the "which directories" half, and
 * `loadSubdirectoryInstructionFile` answers the "what do they say" half.
 *
 * Two rules carry the design:
 *
 * 1. **Only below cwd.** Everything from the project root down to cwd is
 *    already fixed weight loaded at spawn (`instruction-files.ts`), so the
 *    conditional half is exactly the subtree underneath. That makes the two
 *    complements rather than overlapping sets, and it is why the Context
 *    Management tab's `conditional` rows and this injector describe the same
 *    files (`provider-conventions.ts`, `resolveSubdirectoryScanRoot`).
 * 2. **A candidate must contain a path separator.** That reads like a
 *    heuristic and is actually the exact condition: a token with no separator
 *    is either a bare filename in cwd - whose directory is cwd, which holds no
 *    conditional weight - or not a path at all. Nothing that could trigger an
 *    injection is lost by ignoring it.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { contextPathKey } from "../context-management/context-graph-scanner.js";
import { ancestorsBetween } from "../context-management/provider-conventions.js";

/**
 * Bounds on one tool call's arguments. A tool result is not a trusted shape -
 * an MCP server or a mistyped model can hand back a megabyte of prose in an
 * argument - and this runs on every successful call in the loop.
 */
const MAX_ARG_DEPTH = 3;
const MAX_STRING_CHARS = 4_096;
const MAX_CANDIDATES_PER_CALL = 32;

/** Scheme prefix of a URL, which shares a separator with a path and nothing else. */
const URL_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//iu;

/**
 * Path-ish tokens from one tool call's arguments.
 *
 * Deliberately shape-agnostic. The builtin tools name their target `path`, but
 * Otto catalog tools and MCP tools have argument shapes the loop cannot know,
 * and `run_command` hides its paths inside a shell string. Walking every string
 * value and splitting it on whitespace covers all three with one rule, and the
 * separator test plus the existence check downstream throw away everything that
 * was never a path.
 */
export function extractToolPathCandidates(args: unknown): string[] {
  const candidates: string[] = [];

  function visitString(value: string): void {
    if (value.length > MAX_STRING_CHARS) return;
    for (const rawToken of value.split(/\s+/u)) {
      if (candidates.length >= MAX_CANDIDATES_PER_CALL) return;
      const token = trimTokenPunctuation(rawToken);
      if (token.length === 0) continue;
      if (!token.includes("/") && !token.includes("\\")) continue;
      // A URL is not a path, and `https://host/a/b` resolves to a
      // plausible-looking one. Rejected here rather than downstream, so a
      // candidate list is only ever made of things that could be paths.
      if (URL_PREFIX.test(token)) continue;
      candidates.push(token);
    }
  }

  function visit(value: unknown, depth: number): void {
    if (candidates.length >= MAX_CANDIDATES_PER_CALL || depth > MAX_ARG_DEPTH) return;
    if (typeof value === "string") {
      visitString(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (value && typeof value === "object") {
      for (const entry of Object.values(value)) visit(entry, depth + 1);
    }
  }

  visit(args, 0);
  return candidates;
}

/** Shell and prose punctuation that rides along with a path token. */
function trimTokenPunctuation(token: string): string {
  return token.replace(/^["'`([]+/u, "").replace(/["'`)\],;:]+$/u, "");
}

export interface ResolveTouchedSubtreesInput {
  /** Raw tokens from `extractToolPathCandidates`. */
  candidates: readonly string[];
  /** The agent's working directory - the boundary conditional weight starts at. */
  cwd: string;
}

/**
 * The directories under `cwd` that the given tokens actually touched, outermost
 * first.
 *
 * A touched path contributes its whole chain, not just its own directory:
 * editing `packages/app/src/foo.ts` means working under `packages/app` too, and
 * a rule written there has to reach the model the same as one written next to
 * the file. Outermost first so the most specific instructions land last and
 * read as the most authoritative, matching the fixed chain's order.
 *
 * Never throws: a candidate that does not resolve is simply not a subtree.
 */
export async function resolveTouchedSubtreeDirectories(
  input: ResolveTouchedSubtreesInput,
): Promise<string[]> {
  const cwd = path.resolve(input.cwd);
  const seen = new Set<string>();
  const directories: string[] = [];

  for (const candidate of input.candidates) {
    const resolved = resolveCandidate(candidate, cwd);
    if (resolved === null) continue;
    const directory = await directoryOf(resolved);
    if (directory === null) continue;
    // `ancestorsBetween` returns nothing when the directory is not strictly
    // inside cwd, which is exactly the filter this needs: cwd itself and
    // anything outside the workspace carry no conditional weight.
    for (const dir of ancestorsBetween(directory, cwd).toReversed()) {
      const key = contextPathKey(dir);
      if (seen.has(key)) continue;
      seen.add(key);
      directories.push(dir);
    }
  }

  return directories;
}

/** Absolute form of a candidate token, or null when it cannot be one. */
function resolveCandidate(token: string, cwd: string): string | null {
  // `~/notes.md` is a home-relative path, which is outside the workspace by
  // construction - resolving it against cwd would invent a literal `~` folder.
  if (token.startsWith("~")) return null;
  return path.isAbsolute(token) ? path.resolve(token) : path.resolve(cwd, token);
}

/** The directory a path denotes: itself when a directory, its parent otherwise. */
async function directoryOf(absolutePath: string): Promise<string | null> {
  try {
    const stats = await fs.stat(absolutePath);
    if (stats.isDirectory()) return absolutePath;
    return path.dirname(absolutePath);
  } catch {
    // A path that does not exist can still name a real directory - a command
    // that referenced `packages/app/dist/bundle.js`, a file the model deleted.
    // The parent is the claim worth testing; a missing parent means the token
    // was never a path in this workspace.
    const parent = path.dirname(absolutePath);
    if (parent === absolutePath) return null;
    try {
      const stats = await fs.stat(parent);
      return stats.isDirectory() ? parent : null;
    } catch {
      return null;
    }
  }
}
