import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type {
  ProviderPersistence,
  ProviderSessionConfig,
  ProviderTimelineItem,
} from "@getpaseo/plugin/server/provider";
import type { ConnectionSettings } from "../shared/settings.js";
import { endpoint } from "./http.js";
import { LegacyProviders } from "./legacy-config.js";
import {
  PromptImages,
  prepareContent,
  type StoredContent,
  type StoredMessage,
} from "./prompt-content.js";
import { savedSession } from "./session-state.js";
import { preserveImport } from "./session-store.js";
import { qualifyModel } from "./endpoints.js";
import type { ToolCall } from "./completions.js";

const image = z.object({ data: z.string(), mimeType: z.string() });
const call = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
const message = z.discriminatedUnion("role", [
  z
    .object({
      role: z.enum(["system", "user"]),
      content: z.string(),
      messageId: z.string().optional(),
      isCompactionSummary: z.boolean().optional(),
      subtreeInstructionDir: z.string().optional(),
      images: z.array(image).optional(),
    })
    .strict(),
  z
    .object({
      role: z.literal("assistant"),
      content: z.string().nullable(),
      reasoning: z.string().optional(),
      reasoning_content: z.string().optional(),
      reasoning_details: z.array(z.record(z.string(), z.json())).optional(),
      tool_calls: z.array(call).optional(),
    })
    .strict(),
  z
    .object({
      role: z.literal("tool"),
      content: z.string(),
      tool_call_id: z.string(),
      images: z.array(image).optional(),
    })
    .strict(),
]);
const envelope = z.object({
  format: z.literal("otto-openai-0.9-handle-v1"),
  handle: z
    .object({
      provider: z.string(),
      sessionId: z.string().min(1),
      metadata: z
        .object({
          model: z.string().optional(),
          modeId: z.string().optional(),
          messages: z.array(message),
        })
        .passthrough(),
    })
    .passthrough(),
});
type LegacyMessage = z.infer<typeof message>;

class HistoryImport {
  readonly messages: StoredMessage[] = [];
  readonly timeline: ProviderTimelineItem[] = [];
  readonly turns: Array<{ id: string; offset: number }> = [];
  private readonly pending = new Map<string, number>();
  private readonly toolImages: StoredContent[] = [];
  private readonly images: PromptImages;
  constructor(
    private readonly input: { identity: string; imageDirectory: string; signal: AbortSignal },
  ) {
    this.images = new PromptImages(input.imageDirectory);
  }
  private id(index: number, kind: string): string {
    return `legacy-${createHash("sha256").update(`${this.input.identity}/${index}/${kind}`).digest("hex").slice(0, 32)}`;
  }
  private contentImages(images: z.infer<typeof image>[] | undefined) {
    return prepareContent(
      (images ?? []).map((entry) => ({
        type: "image" as const,
        data: entry.data,
        mimeType: entry.mimeType,
      })),
    );
  }
  private finishGroup(): void {
    for (const [id, index] of this.pending) {
      this.messages.push({
        role: "tool",
        tool_call_id: id,
        content:
          "The earlier tool result is unavailable. This request was not executed again. Inspect the current host state before deciding what to do next.",
      });
      const row = this.timeline[index];
      if (row.type === "tool_call")
        this.timeline[index] = { ...row, status: "canceled", error: null };
    }
    this.pending.clear();
    if (this.toolImages.length)
      this.messages.push({ role: "user", content: this.toolImages.splice(0) });
  }
  private async human(
    value: Extract<LegacyMessage, { role: "user" | "system" }>,
    index: number,
  ): Promise<void> {
    const prepared = this.contentImages(value.images);
    await this.images.save(prepared.images, this.input.signal);
    const id = value.messageId || this.id(index, "user");
    if (value.role === "user" && !value.isCompactionSummary && !value.subtreeInstructionDir) {
      this.turns.push({ id, offset: this.messages.length });
      this.timeline.push({
        id,
        type: "user_message",
        text: value.content,
        messageId: id,
        clientMessageId: id,
      });
    } else if (value.isCompactionSummary)
      this.timeline.push({
        id: this.id(index, "summary"),
        type: "compaction",
        status: "completed",
        trigger: "auto",
      });
    const text =
      value.role === "system"
        ? `[Historical system instruction retained from Otto 0.9]\n${value.content}`
        : value.content;
    this.messages.push({
      role: "user",
      content: Array.isArray(prepared.content)
        ? [{ type: "text", text }, ...prepared.content]
        : text,
    });
  }
  private assistant(value: Extract<LegacyMessage, { role: "assistant" }>, index: number): void {
    if (value.reasoning)
      this.timeline.push({
        id: this.id(index, "reasoning"),
        type: "reasoning",
        text: value.reasoning,
      });
    if (value.content)
      this.timeline.push({
        id: this.id(index, "assistant"),
        type: "assistant_message",
        text: value.content,
      });
    // Legacy reasoning was a display-only field. Never start echoing it to a model.
    this.messages.push({
      role: "assistant",
      content: value.content,
      ...(value.tool_calls ? { tool_calls: value.tool_calls } : {}),
      ...(value.reasoning_content ? { reasoning_content: value.reasoning_content } : {}),
      ...(value.reasoning_details ? { reasoning_details: value.reasoning_details } : {}),
    });
    for (const tool of value.tool_calls ?? []) {
      if (this.pending.has(tool.id))
        throw new Error(
          "Duplicate legacy tool-call identity. The original conversation was left intact.",
        );
      this.pending.set(tool.id, this.timeline.length);
      this.timeline.push(this.toolRow(tool, index));
    }
  }
  private toolRow(tool: ToolCall, index: number): ProviderTimelineItem {
    let input: ProviderPersistence["data"];
    try {
      input = z.json().parse(JSON.parse(tool.function.arguments));
    } catch {
      input = tool.function.arguments;
    }
    return {
      id: this.id(index, tool.id),
      type: "tool_call",
      callId: tool.id,
      name: tool.function.name,
      status: "canceled",
      error: null,
      detail: { type: "unknown", input, output: "Result unavailable after import." },
    };
  }
  private async tool(
    value: Extract<LegacyMessage, { role: "tool" }>,
    index: number,
  ): Promise<void> {
    const rowIndex = this.pending.get(value.tool_call_id);
    const prepared = this.contentImages(value.images);
    await this.images.save(prepared.images, this.input.signal);
    if (Array.isArray(prepared.content)) this.toolImages.push(...prepared.content);
    if (rowIndex === undefined) {
      this.finishGroup();
      this.messages.push({
        role: "user",
        content: `[Historical result for an unavailable tool call ${value.tool_call_id}]\n${value.content}`,
      });
      this.timeline.push({
        id: this.id(index, "orphan"),
        type: "tool_call",
        callId: value.tool_call_id,
        name: "Historical tool result",
        status: "completed",
        error: null,
        detail: { type: "plain_text", text: value.content },
      });
      return;
    }
    this.messages.push({ role: "tool", tool_call_id: value.tool_call_id, content: value.content });
    const row = this.timeline[rowIndex];
    if (row.type === "tool_call")
      this.timeline[rowIndex] = {
        ...row,
        status: "completed",
        error: null,
        detail: {
          type: "unknown",
          input: row.detail.type === "unknown" ? row.detail.input : null,
          output: value.content,
        },
      };
    this.pending.delete(value.tool_call_id);
  }
  async run(messages: LegacyMessage[]): Promise<void> {
    for (const [index, value] of messages.entries()) {
      this.input.signal.throwIfAborted();
      if (value.role !== "tool") this.finishGroup();
      switch (value.role) {
        case "system":
        case "user":
          await this.human(value, index);
          break;
        case "assistant":
          this.assistant(value, index);
          break;
        case "tool":
          await this.tool(value, index);
          break;
      }
    }
    this.finishGroup();
  }
}

interface ImportInput {
  persistence?: ProviderPersistence;
  provider: string;
  home?: string;
  settings: ConnectionSettings;
  config: ProviderSessionConfig;
  signal: AbortSignal;
}

/** COMPAT(otto09Thinking): v0.10.0, review after 2027-04-22. The core can retain
 * the old feature field after migration. Old "off" omitted the request parameter;
 * it did not send a new explicit "none" effort to the endpoint.
 */
export function restoredLegacyConfig(input: {
  config: ProviderSessionConfig;
  persistence?: ProviderPersistence;
}): ProviderSessionConfig {
  const data = input.persistence?.data;
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    data.format !== "otto-openai-compatible-v1" ||
    !data.legacyOrigin
  )
    return input.config;
  const { reasoning_effort: oldEffort, ...settings } = input.config.settings;
  const thinking = input.config.thinkingOption ?? oldEffort;
  if (thinking !== undefined && typeof thinking !== "string")
    throw new Error(
      "The preserved reasoning setting requires review. Original settings were left intact.",
    );
  return {
    ...input.config,
    settings,
    ...(thinking !== undefined
      ? { thinkingOption: thinking === "off" ? "default" : thinking }
      : {}),
  };
}
function legacyEnvelope(persistence: ProviderPersistence | undefined) {
  const data = persistence?.data;
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    data.format !== "otto-openai-0.9-handle-v1"
  )
    return null;
  if (persistence?.version !== 1)
    throw new Error(
      "This legacy conversation version requires review. Original history was left intact.",
    );
  const parsed = envelope.safeParse(data);
  if (!parsed.success)
    throw new Error(
      "This legacy conversation format requires review. Its original history was left intact.",
    );
  return { handle: parsed.data.handle, raw: data.handle };
}
/** COMPAT(otto09Conversation): added in v0.10.0; review after 2027-04-22. */
export async function importLegacyConversation(
  input: ImportInput,
): Promise<{ persistence?: ProviderPersistence; config: ProviderSessionConfig }> {
  const original = legacyEnvelope(input.persistence);
  if (!original) return { persistence: input.persistence, config: input.config };
  if (!input.home)
    throw new Error("Legacy conversation import requires its owning host directory.");
  const { handle } = original;
  if (handle.provider !== input.provider)
    throw new Error(
      "The saved conversation belongs to another provider. Its original history was left intact.",
    );
  const binding = new LegacyProviders(input.home).originalEndpoint(input.provider);
  if (!input.settings.baseUrl || endpoint(input.settings.baseUrl, "chat/completions") !== binding)
    throw new Error(
      "This legacy conversation belongs to a different endpoint. Restore the original provider URL before importing it; its history was left intact.",
    );
  const model = input.config.model ?? handle.metadata.model;
  if (!model)
    throw new Error(
      "Choose the original model before importing this legacy conversation. Its history was left intact.",
    );
  const { reasoning_effort: oldEffort, ...settings } = input.config.settings;
  const thinking = input.config.thinkingOption ?? oldEffort;
  const config: ProviderSessionConfig = {
    ...input.config,
    model: qualifyModel("primary", model),
    mode: input.config.mode ?? handle.metadata.modeId,
    settings,
    ...(typeof thinking === "string"
      ? { thinkingOption: thinking === "off" ? "default" : thinking }
      : {}),
  };
  preserveImport({
    directory: path.join(input.home, "otto-openai-compatible", "legacy-imports"),
    value: z.json().parse(original.raw),
  });
  const converted = new HistoryImport({
    identity: `${handle.provider}/${handle.sessionId}`,
    imageDirectory: path.join(input.home, "otto-openai-compatible", "images"),
    signal: input.signal,
  });
  await converted.run(handle.metadata.messages);
  const importedAt = new Date().toISOString();
  return {
    config,
    persistence: {
      version: 1,
      data: z.json().parse(
        savedSession.parse({
          format: "otto-openai-compatible-v1",
          endpoint: binding,
          messages: converted.messages,
          timeline: converted.timeline,
          timelineTimestamps: Object.fromEntries(
            converted.timeline.map((row) => [row.id, importedAt]),
          ),
          context: { turns: converted.turns },
          legacyOrigin: { provider: handle.provider, sessionId: handle.sessionId },
          preferences: {
            model: config.model,
            mode: config.mode ?? "default",
            thinkingOption: config.thinkingOption ?? "default",
            output_limit: settings.output_limit ?? "default",
            auto_compact: settings.auto_compact ?? "80",
          },
        }),
      ),
    },
  };
}
