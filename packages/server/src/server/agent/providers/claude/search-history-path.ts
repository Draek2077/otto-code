import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { claudeProjectDirSync } from "./project-dir.js";

export function resolveClaudeSearchHistoryPath(cwd: string, sessionId: string): string;
export function resolveClaudeSearchHistoryPath(
  cwd: string | undefined,
  sessionId: string,
): string | null;
export function resolveClaudeSearchHistoryPath(
  cwd: string | undefined,
  sessionId: string,
): string | null {
  if (!cwd) return null;
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  const candidates = [cwd];
  try {
    const realCwd = fs.realpathSync(cwd);
    if (realCwd !== cwd) candidates.push(realCwd);
  } catch {
    /* A removed workspace can still have retained provider history. */
  }
  for (const candidate of candidates) {
    const file = path.join(claudeProjectDirSync(candidate, { configDir }), `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return path.join(claudeProjectDirSync(cwd, { configDir }), `${sessionId}.jsonl`);
}
