/**
 * Converts a single reference between "always loaded" and "link only"
 * (charter §7.1).
 *
 * The scanner already recorded the byte range of the token that produced the
 * edge, so this is a one-span rewrite rather than a re-parse. It runs
 * server-side because the parent file is frequently outside the workspace root
 * (`~/.claude/CLAUDE.md`), where the client has no write path.
 *
 * The range is verified against the current file contents before writing: if
 * the file moved under us, we refuse rather than corrupt it.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ContextRange } from "./types.js";

export interface ConvertEdgeInput {
  /** Absolute path of the file containing the reference. */
  filePath: string;
  /** Path text as written in the file, e.g. `docs/foo.md`. */
  rawTarget: string;
  range: ContextRange;
  target: "import" | "reference";
}

export type ConvertEdgeResult = { ok: true } | { ok: false; error: string };

export function renderEdgeToken(rawTarget: string, target: "import" | "reference"): string {
  if (target === "import") return `@${rawTarget}`;
  // Link text defaults to the file's base name — short, and the user can edit
  // it afterwards like any other text.
  const label = path.basename(rawTarget).replace(/\.(md|markdown|mdx)$/i, "");
  return `[${label}](${rawTarget})`;
}

export async function convertEdge(input: ConvertEdgeInput): Promise<ConvertEdgeResult> {
  let contents: string;
  try {
    contents = await fs.readFile(input.filePath, "utf8");
  } catch (error) {
    return { ok: false, error: `Could not read ${input.filePath}: ${describe(error)}` };
  }

  const { start, end } = input.range;
  if (start < 0 || end > contents.length || start >= end) {
    return { ok: false, error: "The file changed since it was scanned; refresh and try again." };
  }

  const actual = contents.slice(start, end);
  if (!actual.includes(input.rawTarget)) {
    return { ok: false, error: "The file changed since it was scanned; refresh and try again." };
  }

  const replacement = renderEdgeToken(input.rawTarget, input.target);
  if (replacement === actual) return { ok: true };

  const next = contents.slice(0, start) + replacement + contents.slice(end);
  try {
    await fs.writeFile(input.filePath, next, "utf8");
  } catch (error) {
    return { ok: false, error: `Could not write ${input.filePath}: ${describe(error)}` };
  }
  return { ok: true };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
