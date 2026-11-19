import { z } from "zod";
import {
  getPaseoToolLeafName,
  normalizeToolName,
} from "@getpaseo/protocol/tool-name-normalization";
import type { AgentTimelineItem } from "../../agent/agent-sdk-types.js";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentStorage } from "../../agent/agent-storage.js";
import type { PaseoToolConfig, PaseoToolResult } from "../../agent/tools/types.js";
import type { Logger } from "pino";
import {
  formatProviderModel,
  type BoundCreateAgentCommand,
} from "../../agent/create-agent/create.js";
import { suggestionsFor, type TaskSuggestion } from "./store.js";

type RegisterTaskTool = <Input>(
  name: string,
  config: PaseoToolConfig,
  handler: (input: Input) => Promise<PaseoToolResult>,
) => void;
const Title = z.string().trim().min(1).max(60);
const Summary = z.string().trim().min(1).max(400);
const Prompt = z.string().trim().min(1).max(32_000);
const Id = z.string().min(1).max(512);
const PluginId = "otto-suggested-tasks";

export function redactSuggestionPrompt(item: AgentTimelineItem): AgentTimelineItem {
  if (item.type !== "tool_call") return item;
  if ((getPaseoToolLeafName(item.name) ?? normalizeToolName(item.name)) !== "suggest_task")
    return item;
  if (item.detail?.type !== "unknown") return item;
  const title = Title.safeParse(
    item.detail.input && typeof item.detail.input === "object"
      ? Reflect.get(item.detail.input, "title")
      : undefined,
  );
  return {
    ...item,
    detail: {
      type: "plain_text",
      label: "Suggested task",
      text: title.success ? title.data : "Task suggestion",
      icon: "sparkles",
    },
  };
}

function parentFor(manager: AgentManager, id?: string) {
  const agent = id && manager.getAgent(id);
  if (
    !agent ||
    !agent.workspaceId ||
    agent.internal ||
    agent.owner ||
    agent.lifecycle === "closed"
  ) {
    throw new Error("Only an active, workspace-bound chat can manage its suggestions.");
  }
  return { agent, parent: { agentId: agent.id, workspaceId: agent.workspaceId } };
}

function publishCard(manager: AgentManager, card: TaskSuggestion) {
  return manager.appendTimelineItem(card.agentId, {
    type: "plugin",
    id: card.id,
    pluginId: PluginId,
    kind: "suggested-task",
    version: 1,
    data: { id: card.id, title: card.title, summary: card.summary, workspaceId: card.workspaceId },
  });
}

export function registerSuggestedTaskTools(
  register: RegisterTaskTool,
  manager: AgentManager,
  callerId?: string,
) {
  if (!callerId) return;
  register(
    "suggest_task",
    {
      title: "Suggest a task",
      description:
        "Suggest a task when you notice useful work outside your current assignment. The user reviews and starts it. Keep the title short and provide a self-contained launch prompt.",
      inputSchema: { title: Title, tldr: Summary, prompt: Prompt },
      outputSchema: { task_id: Id },
    },
    async (input: { title: string; tldr: string; prompt: string }) => {
      const { parent } = parentFor(manager, callerId);
      const store = suggestionsFor(manager);
      const card = store.suggest(parent, { ...input, summary: input.tldr });
      try {
        await publishCard(manager, card);
      } catch (error) {
        store.dismiss(parent, card.id);
        throw error;
      }
      return { content: [], structuredContent: { task_id: card.id } };
    },
  );
  register(
    "dismiss_task",
    {
      title: "Dismiss a suggested task",
      description: "Withdraw a pending suggestion from this chat. Dismissing launches nothing.",
      inputSchema: { task_id: Id, reason: z.string().max(400).optional() },
      outputSchema: { dismissed: z.boolean() },
    },
    async ({ task_id }: { task_id: string }) => ({
      content: [],
      structuredContent: {
        dismissed: suggestionsFor(manager).dismiss(parentFor(manager, callerId).parent, task_id),
      },
    }),
  );
}

const Target = z.object({ agentId: Id, workspaceId: Id, taskId: Id }).strict();
const Launch = Target.extend({
  mode: z.enum(["new_chat", "subagent", "worktree", "in_session"]),
  model: z.object({ provider: Id, model: Id }).optional(),
});

export interface SuggestedTaskHost {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  createAgent: BoundCreateAgentCommand;
  logger: Logger;
}

export async function dispatchSuggestion(host: SuggestedTaskHost, method: string, input: unknown) {
  if (!["tasks.get", "tasks.dismiss", "tasks.start"].includes(method)) return undefined;
  const target = (method === "tasks.start" ? Launch : Target).parse(input);
  const { parent, agent } = parentFor(host.agentManager, target.agentId);
  if (target.workspaceId !== parent.workspaceId)
    throw new Error("The suggestion is outside this workspace.");
  const storedParent = await host.agentStorage.get(parent.agentId);
  if (storedParent?.archivedAt) throw new Error("The source chat is archived.");
  const store = suggestionsFor(host.agentManager);
  if (method === "tasks.get")
    return { pending: store.list(parent).some(({ id }) => id === target.taskId) };
  if (method === "tasks.dismiss") return { dismissed: store.dismiss(parent, target.taskId) };

  const selection = Launch.parse(input);
  return store.start(parent, target.taskId, async (card, text) => {
    if (selection.mode === "in_session") {
      // Only the explicit Start request receives the text. Paseo's composer
      // owns the queue and chooses when to dispatch it.
      return { action: "queue", agentId: agent.id, workspaceId: parent.workspaceId, text };
    }

    const selectionModel = selection.model
      ? formatProviderModel(selection.model.provider, selection.model.model)
      : formatProviderModel(agent.provider, agent.config.model);
    const { snapshot } = await host.createAgent({
      kind: "mcp",
      provider: selectionModel,
      title: card.title,
      cwd: agent.cwd,
      workspaceId: parent.workspaceId,
      callerAgentId: agent.id,
      callerContext: { lockedCwd: agent.cwd, allowCustomCwd: false },
      detached: selection.mode !== "subagent",
      worktree: selection.mode === "worktree" ? { action: "branch-off" } : undefined,
      initialPrompt: text,
      promptFailure: "log",
      notifyOnFinish: selection.mode !== "subagent",
    });
    return {
      action: "open",
      agentId: snapshot.id,
      workspaceId: snapshot.workspaceId ?? parent.workspaceId,
    };
  });
}
