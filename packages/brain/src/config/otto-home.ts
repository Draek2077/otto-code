/**
 * Resolves $OTTO_HOME exactly as the Otto daemon does (see
 * packages/server/src/server/otto-home.ts): env override, else `~/.otto`, tilde
 * expanded, made private. Sharing this rule is what lets otto-brain's config sit
 * next to Otto's — and follow it into the dev home whenever the dev scripts export
 * OTTO_HOME. There is deliberately no dev-path logic here; that lives in shell.
 */
import { homedir } from "node:os";
import path from "node:path";

import { ensurePrivateDirectory } from "./private-files.js";

function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) return path.join(homedir(), input.slice(2));
  if (input === "~") return homedir();
  return input;
}

export function resolveOttoHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.OTTO_HOME ?? "~/.otto";
  const resolved = path.resolve(expandHomeDir(raw));
  ensurePrivateDirectory(resolved);
  return resolved;
}
