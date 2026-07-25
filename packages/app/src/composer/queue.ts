import { useCallback, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import {
  editQueuedComposerMessage,
  queueComposerMessage,
  type QueueWriter,
} from "@/composer/actions";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import type { DaemonClient } from "@otto-code/client";

export interface ComposerQueueItem {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
}

export interface ComposerQueueController {
  /** The messages waiting to run, oldest first. */
  items: readonly ComposerQueueItem[];
  /** Park a message so it runs after the turn in flight. */
  enqueue: (text: string, attachments: ComposerAttachment[]) => Promise<void>;
  /** Pull a message back out (to edit it, or to send it right now). */
  take: (id: string) => Promise<ComposerQueueItem | null>;
}

const EMPTY_ITEMS: readonly ComposerQueueItem[] = [];

/**
 * The composer's Queue track, backed by whichever queue the host supports.
 *
 * With `features.steerQueue` the DAEMON owns the queue: the message is sent
 * immediately with `delivery: "queue"`, survives a disconnect or a second
 * client, and everything queued before the turn ends is delivered as one turn.
 * Without it the queue stays in this client, drained on the running→idle edge
 * (see session-context) — the behavior Otto has always had, not a degraded
 * build of the daemon feature.
 *
 * Attachments only ever exist client-side, so the daemon-backed path keeps a
 * local sidecar keyed by the daemon's entry id purely so "edit" can put them
 * back in the box. The daemon still owns whether an entry exists and when it
 * runs; losing the sidecar (reload, other device) costs the attachments on
 * edit, nothing else.
 */
export function useComposerQueue(input: {
  serverId: string;
  agentId: string;
  client: DaemonClient | null;
  encodeImages: (
    images: AttachmentMetadata[],
  ) => Promise<Array<{ data: string; mimeType: string }> | undefined>;
}): ComposerQueueController {
  const { serverId, agentId, client, encodeImages } = input;
  const daemonOwnsQueue = useHostFeature(serverId, "steerQueue");

  const setQueuedMessages = useSessionStore((state) => state.setQueuedMessages);
  const localItems = useSessionStore(
    useShallow((state) => state.sessions[serverId]?.queuedMessages?.get(agentId) ?? EMPTY_ITEMS),
  );
  const daemonItems = useSessionStore(
    useShallow(
      (state) => state.sessions[serverId]?.agents?.get(agentId)?.queuedMessages ?? undefined,
    ),
  );

  const attachmentSidecar = useRef(new Map<string, ComposerAttachment[]>());

  const queueWriter = useMemo<QueueWriter>(
    () => ({
      read: (id) => useSessionStore.getState().sessions[serverId]?.queuedMessages?.get(id) ?? [],
      write: (updater) => setQueuedMessages(serverId, updater),
    }),
    [serverId, setQueuedMessages],
  );

  const items = useMemo<readonly ComposerQueueItem[]>(() => {
    if (!daemonOwnsQueue) {
      return localItems;
    }
    if (!daemonItems || daemonItems.length === 0) {
      return EMPTY_ITEMS;
    }
    const sidecar = attachmentSidecar.current;
    // Entries the daemon no longer reports have run (or were cleared); drop
    // their attachments so the sidecar can't grow without bound.
    const live = new Set(daemonItems.map((entry) => entry.id));
    for (const id of sidecar.keys()) {
      if (!live.has(id)) {
        sidecar.delete(id);
      }
    }
    return daemonItems.map((entry) => ({
      id: entry.id,
      text: entry.preview,
      attachments: sidecar.get(entry.id) ?? [],
    }));
  }, [daemonItems, daemonOwnsQueue, localItems]);

  const enqueue = useCallback(
    async (text: string, attachments: ComposerAttachment[]) => {
      if (!daemonOwnsQueue) {
        queueComposerMessage({ agentId, text, attachments, queue: queueWriter });
        return;
      }
      if (!client) {
        throw new Error("Not connected");
      }
      const wirePayload = splitComposerAttachmentsForSubmit(attachments);
      const images = await encodeImages(wirePayload.images);
      const result = await client.sendAgentMessage(agentId, text, {
        delivery: "queue",
        images: images ?? [],
        attachments: wirePayload.attachments,
      });
      if (result.queuedMessageId && attachments.length > 0) {
        attachmentSidecar.current.set(result.queuedMessageId, attachments);
      }
    },
    [agentId, client, daemonOwnsQueue, encodeImages, queueWriter],
  );

  const take = useCallback(
    async (id: string): Promise<ComposerQueueItem | null> => {
      if (!daemonOwnsQueue) {
        const result = editQueuedComposerMessage({ agentId, messageId: id, queue: queueWriter });
        return result ? { id, text: result.text, attachments: result.attachments } : null;
      }
      if (!client) {
        throw new Error("Not connected");
      }
      const removed = await client.removeQueuedAgentMessage(agentId, id);
      if (!removed) {
        return null;
      }
      const attachments = attachmentSidecar.current.get(id) ?? [];
      attachmentSidecar.current.delete(id);
      return { id: removed.id, text: removed.text, attachments };
    },
    [agentId, client, daemonOwnsQueue, queueWriter],
  );

  return { items, enqueue, take };
}
