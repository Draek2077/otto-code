import { randomUUID } from "node:crypto";

import type { AgentAttachment } from "@otto-code/protocol/messages";

import type {
  AgentPromptContentBlock,
  AgentPromptInput,
  AgentRunOptions,
} from "./agent-sdk-types.js";

/**
 * A steering message parked for delivery as the target agent's NEXT turn.
 *
 * The queue is provider-agnostic on purpose: it lives in the daemon's turn
 * lifecycle (AgentManager), above every provider adapter, so `delivery: "queue"`
 * behaves identically for Claude, Codex, Copilot, OpenCode, Pi and the
 * openai-compatible provider. See projects/steer-queue (folded into
 * docs/chat-lifecycle.md on ship).
 */
export interface SteerQueueEntry {
  id: string;
  prompt: AgentPromptInput;
  runOptions?: AgentRunOptions;
  enqueuedAt: string;
  /**
   * `user` - a person typed it (composer, CLI). `system` - Otto injected it
   * (chat mention, schedule fire, notify-on-finish, agent-to-agent send).
   * Only used to decide whether an entry may be merged with its neighbours.
   */
  source: "user" | "system";
}

export interface CreateSteerQueueEntryInput {
  prompt: AgentPromptInput;
  runOptions?: AgentRunOptions;
  source?: "user" | "system";
  enqueuedAt?: string;
}

export function createSteerQueueEntry(input: CreateSteerQueueEntryInput): SteerQueueEntry {
  return {
    id: randomUUID(),
    prompt: input.prompt,
    ...(input.runOptions ? { runOptions: input.runOptions } : {}),
    enqueuedAt: input.enqueuedAt ?? new Date().toISOString(),
    source: input.source ?? "user",
  };
}

const PREVIEW_MAX_LENGTH = 200;

/** Flatten a prompt to its plain text, ignoring image/attachment blocks. */
export function steerQueuePromptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") {
    return prompt;
  }
  return prompt
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
}

/** Short, wire-safe label for a queued entry - what the Queue track renders. */
export function steerQueuePreview(entry: SteerQueueEntry): string {
  const text = steerQueuePromptText(entry.prompt).trim();
  if (text.length <= PREVIEW_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, PREVIEW_MAX_LENGTH - 1)}…`;
}

/** Split a stored prompt back into the wire shape the composer originally sent. */
export function steerQueuePromptParts(prompt: AgentPromptInput): {
  text: string;
  images: Array<{ data: string; mimeType: string }>;
  attachments: AgentAttachment[];
} {
  if (typeof prompt === "string") {
    return { text: prompt, images: [], attachments: [] };
  }
  const images: Array<{ data: string; mimeType: string }> = [];
  const attachments: AgentAttachment[] = [];
  const texts: string[] = [];
  for (const block of prompt) {
    if (block.type === "text") {
      texts.push(block.text);
    } else if (block.type === "image") {
      images.push({ data: block.data, mimeType: block.mimeType });
    } else {
      attachments.push(block);
    }
  }
  return { text: texts.join("\n\n"), images, attachments };
}

/**
 * Whether two adjacent entries may be delivered as a single turn.
 *
 * Decision (resolves "Queued messages should merge into one send" from the
 * remaining-work registry): consecutive **user** messages merge. Three notes
 * dropped while an agent grinds through a refactor are one instruction set, not
 * three turns - delivering them separately makes the agent act on note 1 before
 * it has seen the constraint in note 3, and re-sends the whole context each
 * time. System-injected entries (`source: "system"`) never merge: they carry
 * their own envelope and each one means something on its own.
 */
function canMerge(a: SteerQueueEntry, b: SteerQueueEntry): boolean {
  return a.source === "user" && b.source === "user";
}

/**
 * Move one entry to a new position, keeping every other entry's relative order.
 * Returns null when the id is gone (the turn drained it while the gesture was
 * in flight) or the move is a no-op, so the caller can skip the state emit.
 *
 * `toIndex` is clamped rather than rejected: the client renders a snapshot that
 * may already be one drain behind, and a move that lands at the end of a
 * shorter queue is what the user meant.
 */
export function moveSteerQueueEntry(
  queue: readonly SteerQueueEntry[],
  entryId: string,
  toIndex: number,
): SteerQueueEntry[] | null {
  const fromIndex = queue.findIndex((entry) => entry.id === entryId);
  if (fromIndex === -1) {
    return null;
  }
  const target = Math.min(Math.max(toIndex, 0), queue.length - 1);
  if (target === fromIndex) {
    return null;
  }
  const next = [...queue];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(target, 0, moved!);
  return next;
}

export interface SteerQueueBatch {
  entries: SteerQueueEntry[];
  rest: SteerQueueEntry[];
}

/**
 * Pop the next batch off a queue without mutating it. Returns null for an empty
 * queue. The batch is the head plus every following entry that may merge with
 * it - the caller delivers the batch as ONE turn (see `mergeSteerQueueBatch`).
 */
export function takeNextSteerQueueBatch(queue: readonly SteerQueueEntry[]): SteerQueueBatch | null {
  const head = queue[0];
  if (!head) {
    return null;
  }
  let end = 1;
  while (end < queue.length && canMerge(queue[end - 1]!, queue[end]!)) {
    end += 1;
  }
  return { entries: queue.slice(0, end), rest: queue.slice(end) };
}

/**
 * Collapse a batch into the single prompt that gets dispatched. Text is joined
 * in FIFO order with a blank line between messages; images and attachments are
 * concatenated in the same order. The head entry's `runOptions` win - its
 * `messageId` is the one the client is waiting to reconcile.
 */
export function mergeSteerQueueBatch(entries: readonly SteerQueueEntry[]): {
  prompt: AgentPromptInput;
  runOptions?: AgentRunOptions;
} {
  const head = entries[0];
  if (!head) {
    throw new Error("mergeSteerQueueBatch called with an empty batch");
  }
  const runOptions = head.runOptions;
  if (entries.length === 1) {
    return { prompt: head.prompt, ...(runOptions ? { runOptions } : {}) };
  }

  const texts: string[] = [];
  const media: AgentPromptContentBlock[] = [];
  for (const entry of entries) {
    const parts = steerQueuePromptParts(entry.prompt);
    const text = parts.text.trim();
    if (text.length > 0) {
      texts.push(text);
    }
    for (const image of parts.images) {
      media.push({ type: "image", data: image.data, mimeType: image.mimeType });
    }
    media.push(...parts.attachments);
  }

  const mergedText = texts.join("\n\n");
  if (media.length === 0) {
    return { prompt: mergedText, ...(runOptions ? { runOptions } : {}) };
  }

  const blocks: AgentPromptContentBlock[] = [];
  if (mergedText.length > 0) {
    blocks.push({ type: "text", text: mergedText });
  }
  blocks.push(...media);
  return { prompt: blocks, ...(runOptions ? { runOptions } : {}) };
}
