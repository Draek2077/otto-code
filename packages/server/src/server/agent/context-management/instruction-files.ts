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
 * What this module does *not* do: subdirectory files below cwd. Claude loads
 * those lazily once the agent touches that subtree, and matching it means
 * injecting mid-turn, which needs its own dedupe and compaction story. Until
 * that exists the openai-compat convention reports no subdirectory root, so the
 * tab does not claim weight that never arrives.
 */

import type { Logger } from "pino";
import { scanContextGraph } from "./context-graph-scanner.js";
import {
  OPENAI_COMPAT_CONTEXT_FAMILY,
  type ContextResolutionInput,
} from "./provider-conventions.js";

export interface LoadInstructionFilesInput extends ContextResolutionInput {
  logger?: Logger;
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
 * Resolve and read the instruction files for one workspace.
 *
 * Never throws: a session that cannot read a context file is a session with
 * less context, not a session that fails to start. Failures are logged and the
 * prompt is built from whatever did resolve.
 */
export async function loadInstructionFiles(
  input: LoadInstructionFilesInput,
): Promise<LoadedInstructionFiles> {
  const { logger, ...resolution } = input;
  try {
    const scan = await scanContextGraph(OPENAI_COMPAT_CONTEXT_FAMILY, resolution, {
      ownsContextPayload: true,
      fixedOnly: true,
      includeText: true,
    });

    const blocks: string[] = [];
    const paths: string[] = [];
    for (const { node, text } of scan.contents ?? []) {
      // `fixedOnly` already excludes the roster and the subdirectory sweep;
      // this guard keeps the loader correct if either ever returns.
      if (node.costClass !== "fixed") continue;
      if (node.category !== "context_files") continue;
      const block = renderBlock(node.relPath, text);
      if (!block) continue;
      blocks.push(block);
      paths.push(node.path);
    }

    if (blocks.length === 0) return EMPTY;
    return { text: blocks.join("\n\n"), paths };
  } catch (error) {
    logger?.warn({ err: error, cwd: input.cwd }, "Failed to load instruction files");
    return EMPTY;
  }
}
