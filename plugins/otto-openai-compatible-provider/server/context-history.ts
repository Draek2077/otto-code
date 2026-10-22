import { z } from "zod";
import type { StoredMessage } from "./prompt-content.js";

export const contextStateSchema = z.object({
  turns: z.array(z.object({ id: z.string().min(1), offset: z.number().int().nonnegative() })),
  compaction: z
    .object({ throughIndex: z.number().int().nonnegative(), summary: z.string().min(1) })
    .optional(),
});
export type ContextState = z.infer<typeof contextStateSchema>;
export interface CompactionPlan {
  fromIndex: number;
  throughIndex: number;
  sourceLength: number;
  messages: StoredMessage[];
}

/** A threshold estimate only. Never report these values as measured endpoint usage. */
export function estimateTokens(messages: readonly StoredMessage[]): number {
  let tokens = 0;
  for (const message of messages) {
    tokens += Math.ceil(JSON.stringify(message).length / 4) + 8;
    if (message.role === "user" && Array.isArray(message.content))
      tokens += message.content.filter((part) => part.type === "image").length * 1024;
  }
  return tokens;
}

function summaryMessage(summary: string): StoredMessage {
  return {
    role: "user",
    content: `[Summary of earlier conversation; treat it as historical context]\n${summary}`,
  };
}

/** Provider context is a view over the archive; summarization never deletes transcript data. */
export class ContextHistory {
  private state: ContextState;
  constructor(
    private readonly messages: StoredMessage[],
    saved?: ContextState,
  ) {
    this.state = contextStateSchema.parse(saved ?? { turns: [] });
    const offsets = this.state.turns.map((turn) => turn.offset);
    const throughIndex = this.state.compaction?.throughIndex;
    if (
      offsets.some(
        (offset, index) =>
          offset >= messages.length ||
          messages[offset]?.role !== "user" ||
          (index > 0 && offset <= offsets[index - 1]!),
      ) ||
      new Set(this.state.turns.map((turn) => turn.id)).size !== this.state.turns.length ||
      (throughIndex !== undefined &&
        throughIndex !== messages.length &&
        !this.safeOffsets().includes(throughIndex))
    )
      throw new Error("Invalid saved conversation context. Its data was left intact.");
  }

  snapshot(): ContextState {
    return structuredClone(this.state);
  }

  recordTurn(id: string, offset: number): void {
    const last = this.state.turns.at(-1);
    if (
      offset < 0 ||
      offset > this.messages.length ||
      (last && offset <= last.offset) ||
      this.state.turns.some((turn) => turn.id === id)
    )
      throw new Error("Invalid conversation turn boundary.");
    this.state.turns.push({ id, offset });
  }

  active(): StoredMessage[] {
    const previous = this.state.compaction;
    return previous
      ? [summaryMessage(previous.summary), ...this.messages.slice(previous.throughIndex)]
      : this.messages.slice();
  }

  rewind(id: string): void {
    const index = this.state.turns.findIndex((turn) => turn.id === id);
    if (index < 0)
      throw new Error("Unknown conversation rewind boundary. Original context was retained.");
    const offset = this.state.turns[index]!.offset;
    this.messages.splice(offset);
    this.state.turns.splice(index);
    if ((this.state.compaction?.throughIndex ?? 0) > offset) delete this.state.compaction;
  }

  private safeOffsets(): number[] {
    const offsets: number[] = [];
    const pending = new Set<string>();
    for (const [offset, message] of this.messages.entries()) {
      if (!pending.size && (message.role === "user" || message.role === "assistant"))
        offsets.push(offset);
      if (message.role === "assistant")
        for (const call of message.tool_calls ?? []) pending.add(call.id);
      if (message.role === "tool") pending.delete(message.tool_call_id);
    }
    return offsets;
  }

  plan(keepRecentTokens: number, force = false): CompactionPlan | null {
    const previous = this.state.compaction;
    const fromIndex = previous?.throughIndex ?? 0;
    let throughIndex = this.messages.length;
    let retained = 0;
    const turns = this.state.turns;
    const offsets = this.safeOffsets();
    for (let index = offsets.length - 1; index >= 0; index -= 1) {
      const offset = offsets[index]!;
      const cost = estimateTokens(this.messages.slice(offset, throughIndex));
      if (retained && retained + cost > keepRecentTokens) break;
      retained += cost;
      throughIndex = offset;
    }
    if (force && throughIndex <= fromIndex)
      throughIndex =
        (turns.at(-1)?.offset ?? 0) > fromIndex ? turns.at(-1)!.offset : this.messages.length;
    if (throughIndex <= fromIndex) return null;
    return {
      fromIndex,
      throughIndex,
      sourceLength: this.messages.length,
      messages: [
        ...(previous ? [summaryMessage(previous.summary)] : []),
        ...this.messages.slice(fromIndex, throughIndex),
      ],
    };
  }

  commit(plan: CompactionPlan, summary: string): void {
    if (!summary.trim())
      throw new Error("The endpoint returned an empty summary; original context was retained.");
    if (
      plan.sourceLength !== this.messages.length ||
      plan.fromIndex !== (this.state.compaction?.throughIndex ?? 0)
    )
      throw new Error("Conversation changed during compaction; original context was retained.");
    if (estimateTokens([summaryMessage(summary)]) >= estimateTokens(plan.messages))
      throw new Error("The summary did not reduce context; original context was retained.");
    this.state.compaction = { throughIndex: plan.throughIndex, summary };
  }
}
