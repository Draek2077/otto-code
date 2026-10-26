import { z } from "zod";
import { PreviewStartGate, type PreviewCommandApproval } from "../../preview/server/start-gate.js";
import type { AgentTool } from "./tools.js";
import type { ProviderToolCallDetail } from "../../../server/provider.js";
import type { SessionPreferences } from "./session-config.js";

export interface PreparedPreviewCall {
  input: Record<string, z.infer<ReturnType<typeof z.json>>>;
  detail: ProviderToolCallDetail;
  approval?: PreviewCommandApproval;
}
export async function preparePreviewCall(
  gate: PreviewStartGate,
  tool: AgentTool,
  input: PreparedPreviewCall["input"],
): Promise<PreparedPreviewCall> {
  // The injected Otto MCP server is host-owned. An unrelated MCP tool with the
  // same name retains its own contract and ordinary permission policy.
  if (tool.preapproval?.server !== "otto" || tool.preapproval.tool !== "preview_start")
    return { input, detail: tool.detail(input) };
  const name = z.string().min(1).max(128).parse(input.name);
  const approval = await gate.resolve(name);
  return {
    input: { ...input, commandRevision: approval.revision },
    approval,
    detail: { type: "shell", command: approval.command, cwd: approval.cwd },
  };
}
export function previewPermissionDecision(
  mode: SessionPreferences["mode"],
  approval: PreviewCommandApproval | undefined,
  preapproved = false,
): "allow" | "deny" | "ask" | undefined {
  if (!approval) return undefined;
  if (mode === "plan") return "deny";
  if (mode === "bypassPermissions") return "allow";
  // The file snapshot restricts an exact MCP grant; it never creates a grant
  // merely because a server chose the name "otto".
  if (preapproved && !approval.changed) return "allow";
  if (mode === "dontAsk") return "deny";
  return "ask";
}
export async function acceptPreviewCall(
  gate: PreviewStartGate,
  prepared: PreparedPreviewCall,
  input: PreparedPreviewCall["input"],
): Promise<void> {
  if (!prepared.approval) return;
  if (input.name !== prepared.approval.name || input.commandRevision !== prepared.approval.revision)
    throw new Error(
      "The preview target changed during approval. Choose and review the server again.",
    );
  await gate.accept(prepared.approval);
}
