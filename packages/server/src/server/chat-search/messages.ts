import { createHash } from "node:crypto";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";
import type { SearchMessage } from "./types.js";

/** Search uses the same normalized conversation across every provider. Tool output is excluded. */
export function projectSearchMessages(rows: readonly AgentTimelineRow[]): SearchMessage[] {
  const messages: SearchMessage[] = [];
  let previousIdentity: string | undefined;
  for (const row of rows) {
    const item = row.item;
    if (item.type !== "user_message" && item.type !== "assistant_message") {
      previousIdentity = undefined;
      continue;
    }
    const role = item.type === "user_message" ? "user" : "assistant";
    const identity = item.messageId;
    const previous = messages.at(-1);
    if (
      role === "assistant" &&
      identity &&
      identity === previousIdentity &&
      previous?.role === role &&
      previous.sourceSeq === row.seq - 1
    ) {
      previous.text += item.text;
      previous.sourceSeq = row.seq;
    } else {
      messages.push({
        key: "",
        role,
        text: item.text,
        timestamp: row.timestamp,
        sourceSeq: row.seq,
      });
    }
    previousIdentity = identity;
  }
  const occurrences = new Map<string, number>();
  for (const message of messages) {
    // Epochs and provider IDs can change on hydration. Content + occurrence identifies a
    // logical message, and resolving it again prevents stale sequence navigation after rewind.
    const hash = createHash("sha256")
      .update(message.role)
      .update("\0")
      .update(message.text)
      .digest("hex");
    const occurrence = occurrences.get(hash) ?? 0;
    occurrences.set(hash, occurrence + 1);
    message.key = `${hash}:${occurrence}`;
  }
  return messages;
}
