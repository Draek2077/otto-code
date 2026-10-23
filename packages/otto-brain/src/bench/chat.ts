import { z } from "zod/v3";

const ToolCallSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.unknown().optional(),
    function: z
      .object({ name: z.string().optional(), arguments: z.unknown().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
const ChatMessageSchema = z
  .object({
    role: z.string().optional(),
    content: z.string().nullable().optional(),
    reasoning_content: z.string().optional(),
    tool_calls: z.array(ToolCallSchema).optional(),
  })
  .passthrough();
const ChatUsageSchema = z
  .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
  .passthrough();
const ChatTimingsSchema = z
  .object({
    prompt_ms: z.number().optional(),
    prompt_per_second: z.number().optional(),
    predicted_per_second: z.number().optional(),
  })
  .passthrough();
const ChatChoiceSchema = z
  .object({
    message: ChatMessageSchema.optional(),
    finish_reason: z.string().nullable().optional(),
  })
  .passthrough();
export const ChatResponseSchema = z
  .object({
    choices: z.array(ChatChoiceSchema).optional(),
    usage: ChatUsageSchema.optional(),
    timings: ChatTimingsSchema.optional(),
    error: z.string().optional(),
  })
  .passthrough();
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatChoice = z.infer<typeof ChatChoiceSchema>;
export type ChatUsage = z.infer<typeof ChatUsageSchema>;
export type ChatTimings = z.infer<typeof ChatTimingsSchema>;

export interface ChatRequestOptions {
  host: string;
  port: number;
  payload: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxResponseBytes?: number;
}

/** The operation owns this request through its scheduler lease and abort signal. */
export async function requestChat({
  host,
  port,
  payload,
  timeoutMs = 900000,
  signal,
  maxResponseBytes = 16 * 1024 * 1024,
}: ChatRequestOptions): Promise<ChatResponse> {
  signal?.throwIfAborted();
  const authority = host.includes(":") ? `[${host}]` : host;
  const cancellation = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(signal ? [signal] : []),
  ]);
  const response = await fetch(`http://${authority}:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: cancellation,
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Brain completion request failed (${response.status})`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Brain completion response was empty");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxResponseBytes)
        throw new Error("Brain completion response exceeded its size limit");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  cancellation.throwIfAborted();
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Brain completion response was invalid JSON");
  }
  const parsed = ChatResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Brain completion response had an invalid shape");
  return parsed.data;
}
