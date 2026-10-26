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
  type ProviderConfigChanges,
  type ProviderModel,
} from "../../../server/provider.js";
import type { ConnectionSettings } from "../shared/settings.js";
import { streamCompletion, type ToolCall } from "./completions.js";
import { endpoint } from "./http.js";
import { boundedResult, nativeTools, type AgentTool } from "./tools.js";
import { loadMcpTools } from "./mcp.js";
import {
  prepareContent,
  PromptImages,
  type StoredMessage,
  type StoredContent,
} from "./prompt-content.js";
import { SessionConfiguration, type SessionPreferences } from "./session-config.js";
import { isToolAvailable, toolDecision } from "./tool-policy.js";
import { ContextHistory, type ContextState } from "./context-history.js";
import { Compactor, type CompactionPolicy } from "./compaction.js";
import { savedSession } from "./session-state.js";
import type { SessionArchive } from "./session-store.js";
import type { InstructionSource } from "./instructions.js";
import type { PreparedContext } from "./context-inspection.js";

const jsonObject = z.record(z.string(), z.json());
const revertToken = z.object({ format: z.literal("otto-openai-revert-v1"), id: z.string().min(1) });

interface OpenAiSessionOptions {
  compaction?: CompactionPolicy;
  transport?: typeof fetch;
  id: string;
  config: ProviderSessionConfig;
  settings: ConnectionSettings;
  emit(event: ProviderEvent): void;
  persistence?: ProviderPersistence;
  supportsPermissions?: boolean;
  imageDirectory?: string;
  models?: readonly ProviderModel[];
  profileId?: string;
  archive?: SessionArchive;
  instructions?: InstructionSource;
  resolveApiKey?(): Promise<string | undefined>;
}

export class OpenAiSession {
  private preparedContext: PreparedContext | null = null;
  private captureContext(system: string, tools: readonly unknown[]): void {
    const serialized = JSON.stringify(tools);
    this.preparedContext =
      system.length + serialized.length <= 524288
        ? {
            capturedAt: new Date().toISOString(),
            phase: "prepared",
            system,
            instructionText: this.instructions?.preparedText() ?? "",
            tools: serialized,
            blocks: [...(this.instructions?.preparedBlocks() ?? [])],
          }
        : null;
  }
  private completeContext(): void {
    if (this.preparedContext)
      this.preparedContext = { ...this.preparedContext, phase: "completed" };
  }
  inspectContext(): PreparedContext | null {
    return this.preparedContext;
  }
  readonly id: string;
  readonly config: ProviderSessionConfig;
  readonly settings: ConnectionSettings;
  private readonly emit: (event: ProviderEvent) => void;
  private readonly supportsPermissions: boolean;
  private readonly resolveApiKey: () => Promise<string | undefined>;
  private readonly transport?: typeof fetch;
  private readonly compactionPolicy?: CompactionPolicy;
  readonly timeline = new Map<string, ProviderTimelineItem>();
  private readonly timelineTimestamps = new Map<string, string>();
  readonly messages: StoredMessage[];
  private readonly images: PromptImages;
  private readonly preferences: SessionConfiguration;
  private readonly cacheKey: string;
  private readonly context: ContextHistory;
  private readonly compactor: Compactor;
  private readonly pendingToolImages: StoredContent[] = [];
  private readonly archive?: SessionArchive;
  private readonly instructions?: InstructionSource;
  private readonly legacyOrigin?: { provider: string; sessionId: string };
  private storageFailure: Error | null = null;
  private active: { controller: AbortController; promise: Promise<void> } | null = null;
  private readonly tools: Map<string, AgentTool>;
  private readonly permissions = new Map<string, (response: ProviderPermissionResponse) => void>();
  private external: Awaited<ReturnType<typeof loadMcpTools>> | null = null;

  constructor(options: OpenAiSessionOptions) {
    const { id, config, settings, emit, persistence, imageDirectory, models = [] } = options;
    this.id = id;
    this.transport = options.transport;
    this.compactionPolicy = options.compaction;
    this.archive = options.archive;
    this.instructions = options.instructions;
    this.config = config;
    this.settings = settings;
    this.emit = emit;
    this.supportsPermissions = options.supportsPermissions ?? true;
    this.resolveApiKey =
      options.resolveApiKey ??
      (async () => config.env[settings.apiKeyEnv] ?? process.env[settings.apiKeyEnv]);
    this.images = new PromptImages(imageDirectory);
    let previousPreferences: SessionPreferences | undefined;
    let previousCacheKey: string | undefined;
    let previousContext: ContextState | undefined;
    endpoint(settings.baseUrl, "chat/completions");
    if (persistence) {
      if (persistence.version !== 1)
        throw new Error(
          "This saved OpenAI-compatible session needs a supported migration. Its data was left intact.",
        );
      const saved = savedSession.parse(persistence.data);
      this.legacyOrigin = saved.legacyOrigin;
      previousPreferences = saved.preferences;
      previousCacheKey = saved.cacheKey;
      previousContext = saved.context;
      if (saved.endpoint !== endpoint(settings.baseUrl, "chat/completions"))
        throw new Error(
          "This conversation belongs to a different endpoint. Restore that endpoint before resuming it.",
        );
      this.messages = saved.messages;
      for (const [itemId, timestamp] of Object.entries(saved.timelineTimestamps ?? {}))
        this.timelineTimestamps.set(itemId, timestamp);
      this.pendingToolImages.push(...(saved.pendingToolImages ?? []));
      for (const item of saved.timeline) {
        const event = ProviderEventSchema.parse({ type: "timeline.item", sessionId: id, item });
        if (event.type === "timeline.item") this.timeline.set(event.item.id, event.item);
      }
    } else this.messages = [];
    this.preferences = new SessionConfiguration(
      config,
      models,
      previousPreferences,
      options.profileId,
    );
    this.cacheKey = previousCacheKey ?? randomUUID();
    this.tools = new Map(nativeTools(config).map((tool) => [tool.definition.function.name, tool]));
    this.closeUnansweredTools();
    this.flushToolImages();
    // COMPAT(providerHistory): v0.10.0, remove after 2027-04-22. Earlier plugin
    // records lack human turn offsets. User-role boundaries conservatively keep
    // complete tool groups; old MCP image batches may retain additional context.
    this.context = new ContextHistory(
      this.messages,
      previousContext ?? {
        turns: this.messages.flatMap((message, offset) =>
          message.role === "user" ? [{ id: `historical-${offset}`, offset }] : [],
        ),
      },
    );
    this.compactor = new Compactor(
      this.context,
      (item) => {
        this.item(item);
        this.persist();
      },
      options.compaction,
    );
    this.reconcileTimeline();
  }

  private reconcileTimeline(): void {
    const rewindIds = new Set(this.context.snapshot().turns.map((turn) => turn.id));
    for (const [itemId, item] of this.timeline) {
      if (item.type === "user_message" && rewindIds.has(itemId))
        this.timeline.set(itemId, {
          ...item,
          revertToken: { format: "otto-openai-revert-v1", id: itemId },
        });
      if (item.type === "tool_call" && item.status === "running")
        this.timeline.set(itemId, { ...item, status: "canceled", error: null });
      if (item.type === "compaction" && item.status === "loading")
        this.timeline.set(itemId, { ...item, status: "completed" });
    }
  }

  get running(): boolean {
    return this.active !== null;
  }

  async prepare(signal: AbortSignal): Promise<void> {
    this.external = await loadMcpTools(
      this.config.mcpServers,
      this.settings.timeoutMs,
      signal,
      this.config,
    );
    for (const tool of this.external.tools) this.tools.set(tool.definition.function.name, tool);
  }

  private item(item: ProviderTimelineItem): void {
    this.timeline.set(item.id, item);
    const timestamp = this.timelineTimestamps.get(item.id) ?? new Date().toISOString();
    this.timelineTimestamps.set(item.id, timestamp);
    this.emit({ type: "timeline.item", sessionId: this.id, item, timestamp });
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
          timelineTimestamps: Object.fromEntries(this.timelineTimestamps),
          ...(this.pendingToolImages.length ? { pendingToolImages: this.pendingToolImages } : {}),
          preferences: this.preferences.snapshot(),
          cacheKey: this.cacheKey,
          context: this.context.snapshot(),
          ...(this.legacyOrigin ? { legacyOrigin: this.legacyOrigin } : {}),
        }),
      ),
    );
    this.emit({
      type: "session.persistence",
      sessionId: this.id,
      persistence: this.saveArchive(data),
    });
  }

  checkpoint(): void {
    this.persist();
  }

  private saveArchive(data: ProviderPersistence["data"]): ProviderPersistence {
    if (this.storageFailure) throw this.storageFailure;
    try {
      return this.archive?.save(data) ?? { version: 1, data };
    } catch (error) {
      this.storageFailure = new Error(
        `Conversation history could not be saved. Reopen this chat before continuing. ${error instanceof Error ? error.message : "Saved history was left intact."}`,
        { cause: error },
      );
      this.active?.controller.abort();
      throw this.storageFailure;
    }
  }

  private checkpointAfterFailure(error: unknown): unknown {
    try {
      this.persist();
    } catch (storageError) {
      return storageError;
    }
    return error;
  }

  start(prompt: ProviderPrompt): void {
    if (this.storageFailure) throw this.storageFailure;
    if (this.active) throw new Error("This provider session already has an active turn.");
    const input = prompt.input;
    if (input.type === "command" && (input.name !== "compact" || input.arguments.length > 4000))
      throw new Error("Use /compact with an optional summary focus of at most 4000 characters.");
    const prepared = input.type === "message" ? prepareContent(input.content) : undefined;
    const turnId = randomUUID();
    const controller = new AbortController();
    const preferences = this.preferences.snapshot();
    const promise = Promise.resolve().then(() =>
      prepared
        ? this.run(turnId, controller, prepared, prompt.clientMessageId, preferences)
        : this.compactTurn(
            turnId,
            controller,
            preferences,
            input.type === "command" ? input.arguments : "",
          ),
    );
    this.active = { controller, promise };
    this.emit({
      type: "session.prompt_result",
      sessionId: this.id,
      clientMessageId: prompt.clientMessageId,
      result: { type: "turn", turnId },
    });
    this.emit({ type: "session.turn", sessionId: this.id, turnId, state: "started" });
  }

  private async run(
    turnId: string,
    controller: AbortController,
    prepared: ReturnType<typeof prepareContent>,
    clientMessageId: string,
    preferences: SessionPreferences,
  ): Promise<void> {
    let partial = "";
    let partialCommitted = false;
    const signal = controller.signal;
    const usage: ProviderUsage = {};
    try {
      this.instructions?.beginTurn();
      await this.images.save(prepared.images, signal);
      signal.throwIfAborted();
      const userId = randomUUID();
      this.context.recordTurn(userId, this.messages.length);
      this.messages.push({ role: "user", content: prepared.content });
      this.item({
        id: userId,
        type: "user_message",
        revertToken: { format: "otto-openai-revert-v1", id: userId },
        text: prepared.text,
        messageId: clientMessageId,
        clientMessageId,
      });
      this.persist();
      for (let round = 0; round < this.settings.maxToolRounds; round += 1) {
        partial = "";
        partialCommitted = false;
        const assistantId = randomUUID();
        const reasoningId = randomUUID();
        const tools = this.supportsPermissions
          ? [...this.tools.values()]
              .filter((tool) => isToolAvailable(preferences.mode, tool))
              .map((tool) => tool.definition)
          : [];
        const window = this.preferences.model(preferences.model).contextWindowMaxTokens;
        const systemPrompt = [
          this.config.systemPrompt,
          ...(this.external?.instructions ?? []),
          await this.instructions?.forRequest(),
        ]
          .filter(Boolean)
          .join("\n\n");
        if (
          this.compactor.shouldCompact(
            preferences.auto_compact,
            window,
            Math.ceil((systemPrompt.length + JSON.stringify(tools).length) / 4),
          )
        )
          await this.compactHistory(turnId, controller, preferences, usage, "auto");
        this.captureContext(systemPrompt, tools);
        const result = await streamCompletion({
          ...(await this.completionSettings(preferences)),
          messages: [
            ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
            ...(await this.images.wire(this.context.active(), signal)),
          ],
          tools,
          signal: AbortSignal.any([signal, AbortSignal.timeout(this.settings.timeoutMs)]),
          onText: (text) => {
            partial = text;
            this.item({ id: assistantId, type: "assistant_message", text });
          },
          onReasoning: (text) => this.item({ id: reasoningId, type: "reasoning", text }),
          onUsage: (value) => this.addUsage(turnId, usage, value),
        });
        this.completeContext();
        this.messages.push({
          role: "assistant",
          content: result.content || null,
          ...result.reasoningFields,
          ...(result.toolCalls.length ? { tool_calls: result.toolCalls } : {}),
        });
        partialCommitted = true;
        this.persist();
        if (!result.toolCalls.length) {
          this.active = null;
          this.emit({ type: "session.turn", sessionId: this.id, turnId, state: "completed" });
          return;
        }
        for (const call of result.toolCalls) {
          signal.throwIfAborted();
          this.pendingToolImages.push(...(await this.callTool(call, controller, preferences.mode)));
          this.persist();
          signal.throwIfAborted();
        }
        this.flushToolImages();
        this.persist();
      }
      throw new Error(
        `The tool round limit (${this.settings.maxToolRounds}) was reached. Review the result before continuing.`,
      );
    } catch (error) {
      if (partial && !partialCommitted) this.messages.push({ role: "assistant", content: partial });
      this.closeUnansweredTools();
      this.flushToolImages();
      const failure = this.checkpointAfterFailure(error);
      this.active = null;
      if (controller.signal.aborted && !this.storageFailure)
        this.emit({ type: "session.turn", sessionId: this.id, turnId, state: "canceled" });
      else
        this.emit({
          type: "session.turn",
          sessionId: this.id,
          turnId,
          state: "failed",
          error: { message: failure instanceof Error ? failure.message : String(failure) },
        });
    }
  }

  private async completionSettings(preferences: SessionPreferences, summary = false) {
    const request = this.preferences.requestSettings(this.settings.baseUrl, preferences);
    return {
      baseUrl: this.settings.baseUrl,
      transport: this.transport,
      apiKey: await this.resolveApiKey(),
      ...request,
      ...(summary && this.compactionPolicy
        ? {
            maxTokens: Math.min(
              this.compactionPolicy.summaryMaxTokens,
              request.maxTokens ?? this.compactionPolicy.summaryMaxTokens,
            ),
          }
        : {}),
      cacheKey: this.cacheKey,
    };
  }

  private async compactHistory(
    turnId: string,
    controller: AbortController,
    preferences: SessionPreferences,
    usage: ProviderUsage,
    trigger: "auto" | "manual",
    instruction?: string,
  ): Promise<void> {
    await this.compactor.run({
      trigger,
      instruction,
      contextWindow: this.preferences.model(preferences.model).contextWindowMaxTokens,
      signal: controller.signal,
      complete: async (messages) =>
        streamCompletion({
          ...(await this.completionSettings(preferences, true)),
          messages,
          tools: [],
          onUsage: (value) => this.addUsage(turnId, usage, value),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(this.settings.timeoutMs),
          ]),
        }),
    });
    this.persist();
  }

  private async compactTurn(
    turnId: string,
    controller: AbortController,
    preferences: SessionPreferences,
    instruction: string,
  ): Promise<void> {
    try {
      await this.compactHistory(turnId, controller, preferences, {}, "manual", instruction);
      this.active = null;
      this.emit({ type: "session.turn", sessionId: this.id, turnId, state: "completed" });
    } catch (error) {
      const failure = this.checkpointAfterFailure(error);
      this.active = null;
      if (controller.signal.aborted && !this.storageFailure)
        this.emit({ type: "session.turn", sessionId: this.id, turnId, state: "canceled" });
      else
        this.emit({
          type: "session.turn",
          sessionId: this.id,
          turnId,
          state: "failed",
          error: { message: failure instanceof Error ? failure.message : String(failure) },
        });
    } finally {
      this.active = null;
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
    mode: SessionPreferences["mode"],
  ): Promise<z.infer<typeof jsonObject>> {
    if (!this.supportsPermissions)
      throw new Error("Tool execution was not negotiated with this host.");
    if (!isToolAvailable(mode, tool))
      throw new Error("This tool is unavailable in Read only mode.");
    const grant = tool.preapproval;
    if (
      grant &&
      this.config.toolPolicy?.preapproved.some(
        (value) => value.server === grant.server && value.tool === grant.tool,
      )
    )
      return input;
    const authority = await toolDecision(mode, tool, detail, this.config.cwd);
    if (authority === "allow") return input;
    if (authority === "deny")
      throw new Error("The selected mode denies this action without asking.");
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

  private async callTool(
    call: ToolCall,
    controller: AbortController,
    mode: SessionPreferences["mode"],
  ): Promise<StoredContent[]> {
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
      input = await this.approvedInput(tool, input, detail, controller, mode);
      controller.signal.throwIfAborted();
      detail = tool.detail(input);
      if (
        (call.function.name === "otto_read_file" && detail.type === "read") ||
        (call.function.name === "otto_write_file" && detail.type === "write")
      )
        await this.instructions?.beforeFile({
          file: detail.filePath,
          write: detail.type === "write",
        });
      const result = await tool.execute(input, controller.signal);
      const output = boundedResult(typeof result === "string" ? result : result.text);
      const images = typeof result === "string" ? undefined : prepareContent(result.images);
      if (images) await this.images.save(images.images, controller.signal);
      if (detail.type === "read") detail = { ...detail, content: output };
      else if (detail.type === "shell") detail = { ...detail, output };
      else if (detail.type === "unknown") detail = { ...detail, output };
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
      return images && Array.isArray(images.content) ? images.content : [];
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
      return [];
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

  private flushToolImages(): void {
    if (this.pendingToolImages.length)
      this.messages.push({ role: "user", content: this.pendingToolImages.splice(0) });
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

  configState() {
    return this.preferences.state();
  }

  timestamp(id: string): string | undefined {
    return this.timelineTimestamps.get(id);
  }

  revert(token: unknown): void {
    if (this.active) throw new Error("Stop the current turn before rewinding.");
    const { id } = revertToken.parse(token);
    const ids = [...this.timeline.keys()];
    const index = ids.indexOf(id);
    if (index < 0)
      throw new Error("Unknown conversation rewind boundary. Original context was retained.");
    const before = {
      messages: [...this.messages],
      context: this.context.snapshot(),
      timeline: [...this.timeline],
      timestamps: [...this.timelineTimestamps],
      images: [...this.pendingToolImages],
    };
    this.context.rewind(id);
    for (const removed of ids.slice(index)) {
      this.timeline.delete(removed);
      this.timelineTimestamps.delete(removed);
    }
    this.pendingToolImages.length = 0;
    try {
      this.persist();
    } catch (error) {
      this.messages.splice(0, this.messages.length, ...before.messages);
      this.context.restore(before.context);
      this.timeline.clear();
      for (const [key, value] of before.timeline) this.timeline.set(key, value);
      this.timelineTimestamps.clear();
      for (const [key, value] of before.timestamps) this.timelineTimestamps.set(key, value);
      this.pendingToolImages.push(...before.images);
      throw error;
    }
  }

  configure(changes: ProviderConfigChanges): void {
    if (this.storageFailure) throw this.storageFailure;
    const before = this.preferences.snapshot();
    this.preferences.update(changes);
    try {
      this.persist();
    } catch (error) {
      this.preferences.restore(before);
      throw error;
    }
    this.emit({ type: "session.config", sessionId: this.id, config: this.configState() });
    if (this.active)
      this.emit({
        type: "session.notice",
        sessionId: this.id,
        notice: {
          id: "configuration-next-turn",
          severity: "info",
          title: "Settings saved for the next turn.",
          description:
            "The current turn and its pending permission requests keep their original model, mode and response settings.",
        },
      });
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
