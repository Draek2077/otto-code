import { z } from "zod";
import type { ProviderUsage } from "@getpaseo/plugin/server/provider";
import { endpoint, requireOk, serverEvents } from "./http.js";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
export type ChatMessage =
  | { role: "system" | "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "user"; content: string | ChatContentPart[] }
  | { role: "tool"; tool_call_id: string; content: string };
export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
interface CompletionInput {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  signal: AbortSignal;
  onText?(text: string): void;
  onReasoning?(text: string): void;
}

const chunkSchema = z.object({
  error: z.object({ message: z.string() }).optional(),
  choices: z.array(
    z.object({
      index: z.number(),
      finish_reason: z.string().nullable().optional(),
      delta: z.object({
        content: z.string().nullable().optional(),
        reasoning_content: z.string().nullable().optional(),
        tool_calls: z
          .array(
            z.object({
              index: z.number().int().nonnegative(),
              id: z.string().optional(),
              type: z.literal("function").optional(),
              function: z
                .object({ name: z.string().optional(), arguments: z.string().optional() })
                .optional(),
            }),
          )
          .optional(),
      }),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().nonnegative(),
      completion_tokens: z.number().nonnegative(),
      prompt_tokens_details: z
        .object({ cached_tokens: z.number().nonnegative().optional() })
        .optional(),
    })
    .nullable()
    .optional(),
});

interface CompletionState {
  content: string;
  reasoning: string;
  finished: boolean;
  usage?: ProviderUsage;
  calls: Map<number, ToolCall>;
}
type Choice = z.infer<typeof chunkSchema>["choices"][number];

function mergeChoice(state: CompletionState, choice: Choice, input: CompletionInput): void {
  if (choice.index !== 0) return;
  if (choice.finish_reason) {
    if (choice.finish_reason !== "stop" && choice.finish_reason !== "tool_calls")
      throw new Error(
        `The completion ended with ${choice.finish_reason}; no incomplete tools were executed.`,
      );
    state.finished = true;
  }
  if (choice.delta.content) {
    state.content += choice.delta.content;
    input.onText?.(state.content);
  }
  if (choice.delta.reasoning_content) {
    state.reasoning += choice.delta.reasoning_content;
    input.onReasoning?.(state.reasoning);
  }
  for (const part of choice.delta.tool_calls ?? []) mergeCall(state.calls, part);
  if (
    state.content.length + state.reasoning.length > 2 * 1024 * 1024 ||
    state.calls.size > 64 ||
    [...state.calls.values()].some((call) => call.function.arguments.length > 1024 * 1024)
  )
    throw new Error("The completion exceeded the supported output limit.");
}

function mergeCall(
  calls: Map<number, ToolCall>,
  part: NonNullable<Choice["delta"]["tool_calls"]>[number],
): void {
  const call = calls.get(part.index) ?? {
    id: "",
    type: "function" as const,
    function: { name: "", arguments: "" },
  };
  if (part.id) call.id += part.id;
  if (part.function?.name) call.function.name += part.function.name;
  if (part.function?.arguments) call.function.arguments += part.function.arguments;
  calls.set(part.index, call);
}

export async function streamCompletion(input: CompletionInput) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
  };
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;
  const response = await fetch(endpoint(input.baseUrl, "chat/completions"), {
    method: "POST",
    headers,
    redirect: "error",
    signal: input.signal,
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(input.tools.length ? { tools: input.tools, tool_choice: "auto" } : {}),
    }),
  });
  await requireOk(response, "OpenAI-compatible endpoint", input.apiKey);
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    await response.body?.cancel();
    throw new Error("The endpoint must support streamed Chat Completions.");
  }
  const state: CompletionState = { content: "", reasoning: "", finished: false, calls: new Map() };
  for await (const data of serverEvents(response)) {
    if (data === "[DONE]") break;
    const chunk = chunkSchema.parse(JSON.parse(data));
    if (chunk.error) throw new Error(chunk.error.message);
    for (const choice of chunk.choices) mergeChoice(state, choice, input);
    if (chunk.usage)
      state.usage = {
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
        ...(chunk.usage.prompt_tokens_details?.cached_tokens === undefined
          ? {}
          : { cachedInputTokens: chunk.usage.prompt_tokens_details.cached_tokens }),
      };
  }
  input.signal.throwIfAborted();
  if (!state.finished) throw new Error("The completion stream ended before the model finished.");
  const toolCalls = [...state.calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
  if (toolCalls.some((call) => !call.id || !call.function.name))
    throw new Error("The endpoint returned an incomplete tool call.");
  return { content: state.content, reasoning: state.reasoning, toolCalls, usage: state.usage };
}
