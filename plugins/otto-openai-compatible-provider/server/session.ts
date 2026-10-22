import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ProviderEventSchema,
  type ProviderEvent,
  type ProviderPersistence,
  type ProviderPrompt,
  type ProviderSessionConfig,
  type ProviderTimelineItem,
  type ProviderPermissionResponse,
  type ProviderToolCallDetail,
  type ProviderUsage,
} from "@getpaseo/plugin/server/provider";
import type { ConnectionSettings } from "../shared/settings.js";
import { streamCompletion, type ChatMessage, type ToolCall } from "./completions.js";
import { endpoint } from "./http.js";
import { boundedResult, nativeTools, type AgentTool } from "./tools.js";
import { loadHttpMcpTools } from "./mcp.js";

const savedMessage = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string() }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().nullable(),
    tool_calls: z
      .array(
        z.object({
          id: z.string(),
          type: z.literal("function"),
          function: z.object({ name: z.string(), arguments: z.string() }),
        }),
      )
      .optional(),
  }),
  z.object({ role: z.literal("tool"), tool_call_id: z.string(), content: z.string() }),
]);
const savedSession = z.object({
  format: z.literal("otto-openai-compatible-v1"),
  endpoint: z.string(),
  messages: z.array(savedMessage),
  timeline: z.array(z.json()),
});
const jsonObject = z.record(z.string(), z.json());

export class OpenAiSession {
  readonly timeline = new Map<string, ProviderTimelineItem>();
  readonly messages: ChatMessage[];
  private active: { controller: AbortController; promise: Promise<void> } | null = null;
  private readonly tools: Map<string, AgentTool>;
  private readonly permissions = new Map<string, (response: ProviderPermissionResponse) => void>();
  private external: Awaited<ReturnType<typeof loadHttpMcpTools>> | null = null;

  constructor(
    readonly id: string,
    readonly config: ProviderSessionConfig,
    readonly settings: ConnectionSettings,
    private readonly emit: (event: ProviderEvent) => void,
    persistence?: ProviderPersistence,
    private readonly supportsPermissions = true,
  ) {
    if (!config.model)
      throw new Error("Choose a model before creating an OpenAI-compatible agent.");
    if (config.mode && config.mode !== "default")
      throw new Error(
        "This provider currently supports Ask before tools mode. Saved settings were left intact.",
      );
    endpoint(settings.baseUrl, "chat/completions");
    if (persistence) {
      if (persistence.version !== 1)
        throw new Error(
          "This saved OpenAI-compatible session needs a supported migration. Its data was left intact.",
        );
      const saved = savedSession.parse(persistence.data);
      if (saved.endpoint !== endpoint(settings.baseUrl, "chat/completions"))
        throw new Error(
          "This conversation belongs to a different endpoint. Restore that endpoint before resuming it.",
        );
      this.messages = saved.messages;
      for (const item of saved.timeline) {
        const event = ProviderEventSchema.parse({ type: "timeline.item", sessionId: id, item });
        if (event.type === "timeline.item") this.timeline.set(event.item.id, event.item);
      }
    } else this.messages = [];
    this.tools = new Map(nativeTools(config).map((tool) => [tool.definition.function.name, tool]));
    this.closeUnansweredTools();
    for (const [itemId, item] of this.timeline) {
      if (item.type === "tool_call" && item.status === "running")
        this.timeline.set(itemId, { ...item, status: "canceled", error: null });
    }
  }

  get running(): boolean {
    return this.active !== null;
  }

  async prepare(signal: AbortSignal): Promise<void> {
    this.external = await loadHttpMcpTools(this.config.mcpServers, this.settings.timeoutMs, signal);
    for (const tool of this.external.tools) this.tools.set(tool.definition.function.name, tool);
  }

  private item(item: ProviderTimelineItem): void {
    this.timeline.set(item.id, item);
    this.emit({ type: "timeline.item", sessionId: this.id, item });
  }

  private persist(): void {
    if (!this.config.persist) return;
    const data = z.json().parse(
      JSON.parse(
        JSON.stringify({
          format: "otto-openai-compatible-v1",
          endpoint: endpoint(this.settings.baseUrl, "chat/completions"),
          messages: this.messages,
          timeline: [...this.timeline.values()],
        }),
      ),
    );
    this.emit({
      type: "session.persistence",
      sessionId: this.id,
      persistence: { version: 1, data },
    });
  }

  start(prompt: ProviderPrompt): void {
    if (this.active) throw new Error("This provider session already has an active turn.");
    if (
      prompt.input.type !== "message" ||
      prompt.input.content.some((part) => part.type !== "text")
    )
      throw new Error(
        "This provider slice accepts text prompts. Other attachment types need the corresponding provider capability.",
      );
    const text = prompt.input.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    const turnId = randomUUID();
    const controller = new AbortController();
    this.messages.push({ role: "user", content: text });
    this.item({
      id: randomUUID(),
      type: "user_message",
      text,
      messageId: prompt.clientMessageId,
      clientMessageId: prompt.clientMessageId,
    });
    this.persist();
    const promise = Promise.resolve().then(() => this.run(turnId, controller));
    this.active = { controller, promise };
    this.emit({
      type: "session.prompt_result",
      sessionId: this.id,
      clientMessageId: prompt.clientMessageId,
      result: { type: "turn", turnId },
    });
    this.emit({ type: "session.turn", sessionId: this.id, turnId, state: "started" });
  }

  private async run(turnId: string, controller: AbortController): Promise<void> {
    let partial = "";
    let partialCommitted = false;
    const signal = controller.signal;
    const usage: ProviderUsage = {};
    const systemPrompt = [this.config.systemPrompt, ...(this.external?.instructions ?? [])]
      .filter(Boolean)
      .join("\n\n");
    try {
      for (let round = 0; round < this.settings.maxToolRounds; round += 1) {
        partial = "";
        partialCommitted = false;
        const assistantId = randomUUID();
        const reasoningId = randomUUID();
        const result = await streamCompletion({
          baseUrl: this.settings.baseUrl,
          apiKey: this.config.env[this.settings.apiKeyEnv] ?? process.env[this.settings.apiKeyEnv],
          model: this.config.model!,
          messages: [
            ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
            ...this.messages,
          ],
          tools: this.supportsPermissions
            ? [...this.tools.values()].map((tool) => tool.definition)
            : [],
          signal: AbortSignal.any([signal, AbortSignal.timeout(this.settings.timeoutMs)]),
          onText: (text) => {
            partial = text;
            this.item({ id: assistantId, type: "assistant_message", text });
          },
          onReasoning: (text) => this.item({ id: reasoningId, type: "reasoning", text }),
        });
        this.messages.push({
          role: "assistant",
          content: result.content || null,
          ...(result.toolCalls.length ? { tool_calls: result.toolCalls } : {}),
        });
        partialCommitted = true;
        this.addUsage(turnId, usage, result.usage);
        this.persist();
        if (!result.toolCalls.length) {
          this.active = null;
          this.emit({ type: "session.turn", sessionId: this.id, turnId, state: "completed" });
          return;
        }
        for (const call of result.toolCalls) {
          signal.throwIfAborted();
          await this.callTool(call, controller);
          this.persist();
          signal.throwIfAborted();
        }
      }
      throw new Error(
        `The tool round limit (${this.settings.maxToolRounds}) was reached. Review the result before continuing.`,
      );
    } catch (error) {
      if (partial && !partialCommitted) this.messages.push({ role: "assistant", content: partial });
      this.closeUnansweredTools();
      this.persist();
      this.active = null;
      if (controller.signal.aborted)
        this.emit({ type: "session.turn", sessionId: this.id, turnId, state: "canceled" });
      else
        this.emit({
          type: "session.turn",
          sessionId: this.id,
          turnId,
          state: "failed",
          error: { message: error instanceof Error ? error.message : String(error) },
        });
    }
  }

  private addUsage(turnId: string, total: ProviderUsage, next: ProviderUsage | undefined): void {
    if (!next) return;
    for (const field of ["inputTokens", "outputTokens", "cachedInputTokens"] as const) {
      if (next[field] !== undefined) total[field] = (total[field] ?? 0) + next[field];
    }
    this.emit({ type: "session.usage", sessionId: this.id, turnId, usage: { ...total } });
  }

  private async approvedInput(
    tool: AgentTool,
    input: z.infer<typeof jsonObject>,
    detail: ProviderToolCallDetail,
    controller: AbortController,
  ): Promise<z.infer<typeof jsonObject>> {
    const grant = tool.preapproval;
    if (
      grant &&
      this.config.toolPolicy?.preapproved.some(
        (value) => value.server === grant.server && value.tool === grant.tool,
      )
    )
      return input;
    const decision = await this.permission(
      tool.definition.function.name,
      input,
      detail,
      controller.signal,
    );
    if (decision.behavior === "deny") {
      if (decision.interrupt) controller.abort();
      throw new Error(decision.message ?? "The user declined this tool request.");
    }
    return decision.updatedInput ?? input;
  }

  private async callTool(call: ToolCall, controller: AbortController): Promise<void> {
    const itemId = randomUUID();
    let detail: ProviderToolCallDetail = {
      type: "unknown",
      input: { arguments: call.function.arguments },
      output: null,
    };
    try {
      const tool = this.tools.get(call.function.name);
      if (!tool) throw new Error(`Unknown tool: ${call.function.name}`);
      let input = jsonObject.parse(JSON.parse(call.function.arguments));
      detail = tool.detail(input);
      this.item({
        id: itemId,
        type: "tool_call",
        callId: call.id,
        name: call.function.name,
        detail,
        status: "running",
        error: null,
      });
      input = await this.approvedInput(tool, input, detail, controller);
      controller.signal.throwIfAborted();
      detail = tool.detail(input);
      const output = boundedResult(await tool.execute(input, controller.signal));
      if (detail.type === "read") detail = { ...detail, content: output };
      else if (detail.type === "shell") detail = { ...detail, output };
      this.messages.push({ role: "tool", tool_call_id: call.id, content: output });
      this.item({
        id: itemId,
        type: "tool_call",
        callId: call.id,
        name: call.function.name,
        detail,
        status: "completed",
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: `Tool failed: ${message}`,
      });
      if (controller.signal.aborted)
        this.item({
          id: itemId,
          type: "tool_call",
          callId: call.id,
          name: call.function.name,
          detail,
          status: "canceled",
          error: null,
        });
      else
        this.item({
          id: itemId,
          type: "tool_call",
          callId: call.id,
          name: call.function.name,
          detail,
          status: "failed",
          error: { message },
        });
    }
  }

  private closeUnansweredTools(): void {
    const index = this.messages.findLastIndex(
      (message) => message.role === "assistant" && message.tool_calls?.length,
    );
    const assistant = this.messages[index];
    if (!assistant || assistant.role !== "assistant") return;
    const answered = new Set(
      this.messages
        .slice(index + 1)
        .flatMap((message) => (message.role === "tool" ? [message.tool_call_id] : [])),
    );
    for (const call of assistant.tool_calls ?? [])
      if (!answered.has(call.id))
        this.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content:
            "The previous turn was interrupted. This tool was not resumed; inspect any earlier effects before retrying.",
        });
  }

  private permission(
    name: string,
    input: z.infer<typeof jsonObject>,
    detail: ProviderToolCallDetail,
    signal: AbortSignal,
  ): Promise<ProviderPermissionResponse> {
    if (!this.supportsPermissions)
      return Promise.reject(new Error("The host did not negotiate provider permissions."));
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const clear = () => {
        this.permissions.delete(id);
        signal.removeEventListener("abort", abort);
        this.emit({ type: "session.permission_resolved", sessionId: this.id, permissionId: id });
      };
      const abort = () => {
        clear();
        reject(signal.reason);
      };
      this.permissions.set(id, (response) => {
        clear();
        resolve(response);
      });
      signal.addEventListener("abort", abort, { once: true });
      this.emit({
        type: "session.permission",
        sessionId: this.id,
        request: {
          id,
          name,
          kind: "tool",
          input,
          detail,
          title: `Allow ${name}?`,
          actions: [
            { id: "allow", label: "Allow once", behavior: "allow", variant: "primary" },
            { id: "deny", label: "Deny", behavior: "deny" },
          ],
        },
      });
    });
  }

  respond(id: string, response: ProviderPermissionResponse): void {
    const resolve = this.permissions.get(id);
    if (!resolve) throw new Error("This permission request is no longer pending.");
    resolve(response);
  }

  async interrupt(): Promise<void> {
    const active = this.active;
    if (!active) return;
    active.controller.abort();
    await active.promise;
  }

  async close(): Promise<void> {
    await this.interrupt();
    await this.external?.close();
  }
}
