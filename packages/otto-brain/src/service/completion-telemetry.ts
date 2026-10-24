/** Bounded response evidence. No prompt, output text, credentials or native errors are retained. */
import { StringDecoder } from "node:string_decoder";

type Verdict = "ok" | "reasoning-only" | "truncated" | "failed";
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  return object(value) ? value : {};
}
function chars(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

export class CompletionEvidence {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";
  private event: string[] = [];
  private eventBytes = 0;
  private readable = true;
  private content = 0;
  private reasoning = 0;
  private tool = false;
  private finishReason: unknown = null;
  constructor(private readonly streaming: boolean) {}
  observe(chunk: Buffer): void {
    if (!this.readable) return;
    this.buffer += this.decoder.write(chunk);
    if (this.buffer.length > 1024 * 1024) {
      this.readable = false;
      this.buffer = "";
      this.event = [];
      return;
    }
    if (!this.streaming) return;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/u, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.startsWith("data:")) {
        const data = line.slice(5).trimStart();
        this.event.push(data);
        this.eventBytes += data.length;
      } else if (line === "") this.flushEvent();
      if (this.eventBytes > 1024 * 1024) {
        this.readable = false;
        this.event = [];
        this.buffer = "";
        return;
      }
    }
  }
  finish(failed: boolean): Verdict {
    if (failed) return "failed";
    if (this.readable) {
      this.buffer += this.decoder.end();
      if (this.streaming) {
        if (this.buffer.startsWith("data:")) this.event.push(this.buffer.slice(5).trimStart());
        this.flushEvent();
      } else this.packet(this.buffer);
    }
    if (!this.readable) return "ok"; // Served, with insufficient evidence to classify its output.
    if (this.content === 0 && !this.tool && this.reasoning > 0) return "reasoning-only";
    return this.finishReason === "length" || this.finishReason === "max_tokens"
      ? "truncated"
      : "ok";
  }
  private flushEvent(): void {
    if (this.event.length) this.packet(this.event.join("\n"));
    this.event = [];
    this.eventBytes = 0;
  }
  private packet(text: string): void {
    if (text === "[DONE]") return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      this.readable = false;
      return;
    }
    if (!object(value)) return;
    if (Array.isArray(value.choices)) this.choice(record(value.choices[0]));
    if (Array.isArray(value.content)) for (const block of value.content) this.block(record(block));
    this.block(record(value.content_block));
    const delta = record(value.delta);
    this.content += chars(delta.text);
    this.reasoning += chars(delta.thinking);
    this.finishReason = value.stop_reason ?? delta.stop_reason ?? this.finishReason;
  }
  private choice(choice: Record<string, unknown>): void {
    this.finishReason = choice.finish_reason ?? this.finishReason;
    const message = object(choice.delta) ? choice.delta : record(choice.message);
    this.content += chars(message.content) + chars(choice.text);
    this.reasoning += chars(message.reasoning_content) + chars(message.reasoning);
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) this.tool = true;
    if (Array.isArray(message.content))
      for (const block of message.content) this.block(record(block));
  }
  private block(block: Record<string, unknown>): void {
    if (block.type === "text") this.content += chars(block.text);
    if (block.type === "thinking") this.reasoning += chars(block.thinking);
    if (block.type === "tool_use") this.tool = true;
  }
}

export class CompletionTelemetry {
  private readonly recent: Array<{ modelId: string; verdict: Verdict }> = [];
  private readonly totals = { requests: 0, ok: 0, reasoningOnly: 0, truncated: 0, failed: 0 };
  record(modelId: string, verdict: Verdict): void {
    this.totals.requests++;
    if (verdict === "reasoning-only") this.totals.reasoningOnly++;
    else if (verdict === "truncated") this.totals.truncated++;
    else if (verdict === "failed") this.totals.failed++;
    else this.totals.ok++;
    this.recent.push({ modelId, verdict });
    if (this.recent.length > 50) this.recent.shift();
  }
  resetModel(modelId: string): void {
    for (let index = this.recent.length - 1; index >= 0; index--)
      if (this.recent[index]!.modelId === modelId) this.recent.splice(index, 1);
  }
  snapshot() {
    return { ...this.totals, warning: this.warning() };
  }
  private warning(): string | null {
    const total = this.recent.length;
    if (total < 3) return null;
    const reasoning = this.recent.filter((row) => row.verdict === "reasoning-only").length;
    if (reasoning / total > 0.3)
      return `${reasoning}/${total} recent responses spent all tokens on reasoning and returned no content - lower the reasoning budget`;
    const truncated = this.recent.filter((row) => row.verdict === "truncated").length;
    return truncated / total > 0.3
      ? `${truncated}/${total} recent responses hit the token limit - raise the client's max_tokens`
      : null;
  }
}
