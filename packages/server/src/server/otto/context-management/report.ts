import {
  instructionDigest,
  renderInstructions,
  type InstructionBlock,
  type PreparedContext,
} from "@getpaseo/plugin/server/otto-openai";
import type {
  ContextCategory,
  ContextReport,
  ContextSelection,
} from "@getpaseo/plugin/otto/context-management";
import type { buildContextGraph } from "./graph.js";
import type { NativeContextInventory } from "./native-inventory.js";
export interface InspectedContext {
  provider: string;
  visible: boolean;
  prepared: PreparedContext | null;
  blocks: readonly InstructionBlock[];
  system: string;
  tools: string | null;
  native?: {
    inventory: NativeContextInventory;
    sections: Partial<Record<ContextCategory, string>>;
  };
}
const categories: ContextCategory[] = [
  "context_files",
  "memory_index",
  "skills_roster",
  "mcp_tools",
  "otto_injected",
  "system_prompt",
];
export function contextReport(
  input: InspectedContext,
  graph: Awaited<ReturnType<typeof buildContextGraph>>,
  selection: ContextSelection,
) {
  const instructionText = input.prepared?.instructionText ?? renderInstructions(input.blocks);
  const sections: Partial<Record<ContextCategory, string>> = input.native?.sections ?? {
    context_files: instructionText,
  };
  if (input.prepared) {
    let remaining = input.system;
    if (instructionText) {
      const index = remaining.lastIndexOf(instructionText);
      if (index < 0)
        throw new Error(
          "The provider's instruction preview does not match its prepared system text.",
        );
      remaining = remaining.slice(0, index) + remaining.slice(index + instructionText.length);
    }
    sections.system_prompt = remaining;
    sections.mcp_tools = input.tools ?? "";
  }
  const totals = categories.map((category) => categoryTotal(category, sections, input, selection));
  const fixedTokens = totals.reduce((sum, row) => sum + (row.estimatedTokens ?? 0), 0);
  const sharePercent = Math.round((fixedTokens / selection.windowTokens) * 1000) / 10;
  const revision = instructionDigest(
    JSON.stringify({
      selection: {
        hostId: selection.hostId,
        workspaceId: selection.workspaceId,
        agentId: selection.agentId,
        windowTokens: selection.windowTokens,
      },
      provider: input.provider,
      system: input.system,
      tools: input.tools,
      sections,
      blocks: input.blocks,
      edges: graph.edges,
      nodes: graph.nodes,
    }),
  );
  const report: ContextReport = {
    revision,
    workspaceId: selection.workspaceId,
    provider: input.provider,
    agentId: selection.agentId,
    capturedAt: input.prepared?.capturedAt ?? new Date().toISOString(),
    windowTokens: selection.windowTokens,
    categories: totals,
    nodes: graph.nodes,
    edges: graph.edges,
    findings: graph.findings,
    fixedTokens,
    workingRoom: Math.max(0, selection.windowTokens - fixedTokens),
    sharePercent,
    severity: severity(sharePercent),
    preparedRequest: input.prepared
      ? { capturedAt: input.prepared.capturedAt, phase: input.prepared.phase }
      : null,
  };
  return { report, sections };
}
function categoryTotal(
  category: ContextCategory,
  sections: Partial<Record<ContextCategory, string>>,
  input: InspectedContext,
  selection: ContextSelection,
): ContextReport["categories"][number] {
  const text = sections[category];
  if (input.native && text !== undefined)
    return {
      category,
      visibility: "convention",
      estimatedTokens: Math.ceil(text.length / 4),
      explanation:
        "Bounded provider-convention estimate, not captured request text. Only startup instruction text, memory index and descriptor metadata count here; conditional and linked bodies do not. Provider presets and hidden input remain unknown.",
    };
  const measurable =
    input.visible &&
    text !== undefined &&
    (category !== "context_files" || !selection.agentId || input.prepared !== null);
  return {
    category,
    visibility: measurable ? "exact_text" : "not_visible",
    estimatedTokens: measurable ? Math.ceil(text!.length / 4) : null,
    explanation: explanation(
      category,
      Boolean(selection.agentId),
      Boolean(input.prepared),
      measurable,
    ),
  };
}
function severity(share: number): ContextReport["severity"] {
  if (share >= 50) return "critical";
  if (share >= 25) return "warn";
  if (share >= 10) return "notice";
  return "ok";
}
function explanation(
  category: ContextCategory,
  agent: boolean,
  prepared: boolean,
  measurable: boolean,
): string {
  if (category === "otto_injected" && prepared)
    return "Otto, Knowledge and MCP instructions are included in Remaining system text. No separate count is added twice.";
  if (!measurable)
    return agent && !prepared
      ? "No prepared request is available from this provider. This is unknown, not zero."
      : "Provider-native memory, skills, or hidden input are not observable here. No controls or cost were invented.";
  if (category === "context_files")
    return agent
      ? "Exact instruction text captured when the request was prepared; token count is a characters/4 estimate."
      : "Prospective instruction text from the same resolver the Otto harness uses. It has not been sent to a model.";
  if (category === "mcp_tools")
    return "Exact prepared native and MCP tool schemas together. No server credentials or transport configuration are included.";
  return "Exact remaining prepared system text, including daemon/Knowledge and MCP instructions. It is counted once, not duplicated as a second injection total.";
}
