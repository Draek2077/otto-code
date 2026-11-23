import type { AgentSessionConfig, AgentResumePurpose } from "../../agent/agent-sdk-types.js";

export type KnowledgeSessionPrompt = (workspaceId: string) => Promise<string>;
/** Applies only to a provider's launch config, never the stored conversation.
 * Internal metadata/voice jobs, history reads and disabled tool policies pay no
 * catalog cost. A failed store read is visible and never selects another store. */
export async function appendKnowledgeSessionPrompt(input: {
  config: AgentSessionConfig;
  source?: KnowledgeSessionPrompt;
  workspaceId?: string;
  purpose?: AgentResumePurpose;
  toolsEnabled: boolean;
  disabledTools?: readonly string[];
  unavailable(): void;
}): Promise<AgentSessionConfig> {
  if (
    !input.source ||
    !input.workspaceId ||
    input.config.internal ||
    input.purpose === "history" ||
    !input.toolsEnabled ||
    input.disabledTools?.includes("read_project_knowledge")
  )
    return input.config;
  let catalog: string;
  try {
    catalog = await input.source(input.workspaceId);
  } catch {
    input.unavailable();
    catalog =
      "## Project knowledge catalog\n\nThe owning host could not read this project's Knowledge store. Use the project Knowledge tools to inspect the error before relying on project records. Existing files were not changed or redirected.";
  }
  if (!catalog) return input.config;
  return {
    ...input.config,
    daemonAppendSystemPrompt: [input.config.daemonAppendSystemPrompt?.trim(), catalog]
      .filter(Boolean)
      .join("\n\n"),
  };
}
