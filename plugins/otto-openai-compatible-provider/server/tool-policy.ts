import { realpath } from "node:fs/promises";
import path from "node:path";
import type { ProviderToolCallDetail } from "@getpaseo/plugin/server/provider";
import type { AgentTool } from "./tools.js";
import type { SessionPreferences } from "./session-config.js";

type Mode = SessionPreferences["mode"];
export function isToolAvailable(mode: Mode, tool: AgentTool): boolean {
  return mode !== "plan" || tool.access === "read";
}

async function insideWorkspace(cwd: string, file: string, write: boolean): Promise<boolean> {
  try {
    const root = await realpath(cwd);
    const target = await realpath(write ? path.dirname(file) : file);
    const relative = path.relative(root, target);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

/** Mode policy controls availability and automatic execution; exact MCP grants remain host-owned. */
export async function toolDecision(
  mode: Mode,
  tool: AgentTool,
  detail: ProviderToolCallDetail,
  cwd: string,
): Promise<"allow" | "ask" | "deny"> {
  if (!isToolAvailable(mode, tool)) return "deny";
  if (mode === "bypassPermissions") return "allow";
  if (mode === "default") return "ask";
  const nativeRead = tool.definition.function.name === "otto_read_file" && detail.type === "read";
  const nativeWrite =
    tool.definition.function.name === "otto_write_file" && detail.type === "write";
  if (
    (nativeRead || nativeWrite) &&
    (detail.type === "read" || detail.type === "write") &&
    (await insideWorkspace(cwd, detail.filePath, nativeWrite))
  ) {
    if (nativeRead || mode === "acceptEdits") return "allow";
  }
  return mode === "dontAsk" ? "deny" : "ask";
}
