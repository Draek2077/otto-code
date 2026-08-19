import { z } from "zod";

/**
 * Otto steer-queue wire schemas: the agent.queue.* remove, reorder and clear RPCs and the queued-message payload. Fork-only capability, so it owns its schemas; messages.ts re-exports them.
 */

/**
 * One message parked for delivery as an agent's NEXT turn (`delivery: "queue"`).
 * The daemon owns the queue; this is the read-only projection the Queue track
 * renders. Declared above AgentSnapshotPayloadSchema - zod-aot emits schemas in
 * source order, so a forward reference is a build-time ReferenceError.
 */
export const QueuedAgentMessagePayloadSchema = z.object({
  id: z.string(),
  /** Leading text of the message, truncated for display. */
  preview: z.string(),
  enqueuedAt: z.string(),
  attachmentCount: z.number().int().nonnegative().optional(),
  /**
   * Who parked the message. Absent (from an older daemon) or "user" is a normal
   * user turn; "system" marks a system-injected entry (a chat mention, a
   * scheduled fire) that the daemon's drain never merges into a user turn - the
   * client must likewise exclude it from "Send all".
   */
  source: z.enum(["user", "system"]).optional(),
});

/** Pull one message back out of an agent's queue (Queue-track edit / send now). */
export const AgentQueueRemoveRequestMessageSchema = z.object({
  type: z.literal("agent.queue.remove.request"),
  requestId: z.string(),
  /** Accepts full ID, unique prefix, or exact full title (server resolves). */
  agentId: z.string(),
  /** The queued message's `id` from `AgentSnapshotPayload.queuedMessages`. */
  messageId: z.string(),
});

/**
 * Move one queued message to a different position in an agent's queue.
 *
 * Order is what the queue means, so this is the edit that changes the next
 * turn's content without changing the queue's membership. The daemon resolves
 * `messageId` fresh and clamps `toIndex`, so a client acting on a snapshot that
 * is one drain stale reorders what is actually there or reports `moved: false`.
 * COMPAT(steerQueueReorder): added in v0.6.9, drop the gate when floor >= v0.6.9.
 */
export const AgentQueueReorderRequestMessageSchema = z.object({
  type: z.literal("agent.queue.reorder.request"),
  requestId: z.string(),
  /** Accepts full ID, unique prefix, or exact full title (server resolves). */
  agentId: z.string(),
  /** The queued message's `id` from `AgentSnapshotPayload.queuedMessages`. */
  messageId: z.string(),
  /** Zero-based destination, clamped to the queue's current length. */
  toIndex: z.number().int().nonnegative(),
});

/** Drop every message queued behind an agent's current turn. */
export const AgentQueueClearRequestMessageSchema = z.object({
  type: z.literal("agent.queue.clear.request"),
  requestId: z.string(),
  /** Accepts full ID, unique prefix, or exact full title (server resolves). */
  agentId: z.string(),
});

export const AgentQueueRemoveResponseMessageSchema = z.object({
  type: z.literal("agent.queue.remove.response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    /**
     * The removed message's text, handed back so the composer can put it back
     * in the box for editing or re-send it right away. Null when the id was
     * already gone - the turn drained it while the tap was in flight.
     * Attachments are not echoed: the client that queued the message keeps its
     * own local copy keyed by `id` (see the composer's queued-attachment
     * sidecar), and a client that never queued it has nothing to restore.
     */
    removed: z
      .object({
        id: z.string(),
        text: z.string(),
      })
      .nullable(),
    error: z.string().nullable(),
  }),
});

export const AgentQueueReorderResponseMessageSchema = z.object({
  type: z.literal("agent.queue.reorder.response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    /**
     * False when the id was already gone (the turn drained it while the tap was
     * in flight) or the entry was already at that position. The authoritative
     * order arrives on the agent snapshot either way, so a client only needs
     * this to decide whether to surface an error.
     */
    moved: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const AgentQueueClearResponseMessageSchema = z.object({
  type: z.literal("agent.queue.clear.response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    clearedCount: z.number().int().nonnegative(),
    error: z.string().nullable(),
  }),
});

export type QueuedAgentMessagePayload = z.infer<typeof QueuedAgentMessagePayloadSchema>;

export type AgentQueueRemoveRequestMessage = z.infer<typeof AgentQueueRemoveRequestMessageSchema>;

export type AgentQueueRemoveResponseMessage = z.infer<typeof AgentQueueRemoveResponseMessageSchema>;

export type AgentQueueReorderRequestMessage = z.infer<typeof AgentQueueReorderRequestMessageSchema>;

export type AgentQueueReorderResponseMessage = z.infer<
  typeof AgentQueueReorderResponseMessageSchema
>;

export type AgentQueueClearRequestMessage = z.infer<typeof AgentQueueClearRequestMessageSchema>;

export type AgentQueueClearResponseMessage = z.infer<typeof AgentQueueClearResponseMessageSchema>;
