import { useCallback, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import {
  editQueuedComposerMessage,
  moveQueuedComposerMessage,
  queueComposerMessage,
  type QueueWriter,
} from "@/composer/actions";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import type { DaemonClient } from "@otto-code/client";
import type { QueuedAgentMessagePayload } from "@otto-code/protocol/messages";

export interface ComposerQueueItem {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
  /** "system" for daemon-injected entries (mentions/schedules); else user. */
  source?: "user" | "system";
  /** Attachments the daemon holds for this entry, even if not in the sidecar. */
  attachmentCount?: number;
}

export interface ComposerQueueController {
  /** The messages waiting to run, oldest first. */
  items: readonly ComposerQueueItem[];
  /** Park a message so it runs after the turn in flight. */
  enqueue: (text: string, attachments: ComposerAttachment[]) => Promise<void>;
  /** Pull a message back out (to edit it, or to send it right now). */
  take: (id: string) => Promise<ComposerQueueItem | null>;
  /**
   * The entries "Send all" may merge into one user turn, resolved when it is
   * clicked rather than read off the rendered snapshot. Never trust `items`
   * for this: see `settleEnqueues` for why the snapshot lags.
   */
  listSendable: () => Promise<readonly ComposerQueueItem[]>;
  /**
   * Move a message one place earlier or later. Null when this host cannot
   * re-order, which is what hides the controls - order is still meaningful,
   * there is just no way to change it here.
   */
  move: ((id: string, direction: "up" | "down") => Promise<void>) | null;
}

const EMPTY_ITEMS: readonly ComposerQueueItem[] = [];

/**
 * Turn the daemon's entries into rows, pairing each with whatever attachments
 * this client still holds for it. Also drops sidecar entries the daemon no
 * longer reports - they have run, or were cleared - so the map cannot grow
 * without bound.
 */
function projectDaemonQueueItems(
  daemonItems: readonly QueuedAgentMessagePayload[],
  sidecar: readonly { id: string; attachments: ComposerAttachment[] }[],
): ComposerQueueItem[] {
  const attachmentsById = new Map(sidecar.map((item) => [item.id, item.attachments]));
  return daemonItems.map((entry) => ({
    id: entry.id,
    text: entry.preview,
    attachments: attachmentsById.get(entry.id) ?? [],
    source: entry.source,
    attachmentCount: entry.attachmentCount,
  }));
}

/**
 * Whether "Send all" may pull this entry into the merged user turn. Two kinds
 * must not be, and are left in the queue to drain naturally instead:
 *
 *  - system-injected entries (mentions/schedules), which the daemon's own
 *    drain never merges into a user turn;
 *  - entries whose attachments the daemon holds but this client cannot back.
 *    "Send all" *takes* each entry out of the daemon's queue and re-sends one
 *    merged message built from the client's copy of the attachments, so the
 *    daemon's copy is destroyed by the take: if the sidecar is gone (reload,
 *    another device) the merged turn would go out with those files silently
 *    dropped. Only reachable through `listSendable`, which settles in-flight
 *    enqueues first - so "the client cannot back it" is a real fact here, not
 *    a write that simply hasn't landed yet.
 */
function isSendableAsUserTurn(item: ComposerQueueItem): boolean {
  if (item.source === "system") {
    return false;
  }
  return !((item.attachmentCount ?? 0) > 0 && item.attachments.length === 0);
}

/**
 * The composer's Queue track, backed by whichever queue the host supports.
 *
 * With `features.steerQueue` the DAEMON owns the queue: the message is sent
 * immediately with `delivery: "queue"`, survives a disconnect or a second
 * client, and everything queued before the turn ends is delivered as one turn.
 * Without it the queue stays in this client, drained on the running→idle edge
 * (see session-context) - the behavior Otto has always had, not a degraded
 * build of the daemon feature.
 *
 * Attachments only ever exist client-side, so the daemon-backed path keeps a
 * session-held sidecar keyed by the daemon's entry id purely so this client can
 * put them back - in the box on "edit", or in the merged turn on "Send all".
 * It must be session-held, rather than hook-local: attachment GC traces queued
 * messages through session state, and an image is otherwise collectible after
 * the composer clears it while queueing. The daemon still owns whether an entry
 * exists and when it runs; losing the sidecar (reload, other device) costs
 * those two client-side re-sends, and the entry still drains with its
 * attachments intact from the daemon's own copy.
 *
 * The sidecar is written when the send answers, which is a tick AFTER the
 * daemon has already broadcast the new entry - so nothing may decide anything
 * from `items` alone. `take` and `listSendable` settle first; see
 * `settleEnqueues`.
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
  const daemonCanReorder = useHostFeature(serverId, "steerQueueReorder");

  const setQueuedMessages = useSessionStore((state) => state.setQueuedMessages);
  const localItems = useSessionStore(
    useShallow((state) => state.sessions[serverId]?.queuedMessages?.get(agentId) ?? EMPTY_ITEMS),
  );
  const daemonItems = useSessionStore(
    useShallow(
      (state) => state.sessions[serverId]?.agents?.get(agentId)?.queuedMessages ?? undefined,
    ),
  );

  const inFlightEnqueues = useRef(new Set<Promise<void>>());
  const pendingSidecarSequence = useRef(0);

  /**
   * Wait for every enqueue still in flight.
   *
   * The daemon broadcasts the new entry from inside `enqueueSteerMessage`,
   * BEFORE it answers the send - so the row is on screen a tick before this
   * client learns the entry id it must file the attachments under. Until that
   * write lands the row reads `attachmentCount: 2, attachments: []`, and
   * because the sidecar is a ref, the write that fixes it re-renders nothing.
   * Any decision made from `items` in that window is made on a half-built row.
   *
   * So the read paths settle first instead of guessing. Draining in a loop
   * rather than snapshotting the set once covers an enqueue that starts while
   * we are already waiting.
   */
  const settleEnqueues = useCallback(async () => {
    while (inFlightEnqueues.current.size > 0) {
      await Promise.all(inFlightEnqueues.current);
    }
  }, []);

  const queueWriter = useMemo<QueueWriter>(
    () => ({
      read: (id) => useSessionStore.getState().sessions[serverId]?.queuedMessages?.get(id) ?? [],
      write: (updater) => setQueuedMessages(serverId, updater),
    }),
    [serverId, setQueuedMessages],
  );

  // The sidecar is also the GC root for images queued against a daemon-owned
  // queue. Trim entries as the daemon reports that they have run or cleared.
  useEffect(() => {
    if (!daemonOwnsQueue || daemonItems === undefined) return;
    const live = new Set(daemonItems.map((entry) => entry.id));
    setQueuedMessages(serverId, (previous) => {
      const next = new Map(previous);
      const current = next.get(agentId) ?? [];
      const retained = current.filter(
        (item) => item.id.startsWith("pending:") || live.has(item.id),
      );
      if (retained.length === current.length) return previous;
      if (retained.length === 0) {
        next.delete(agentId);
      } else {
        next.set(agentId, retained);
      }
      return next;
    });
  }, [agentId, daemonItems, daemonOwnsQueue, serverId, setQueuedMessages]);

  const items = useMemo<readonly ComposerQueueItem[]>(() => {
    if (!daemonOwnsQueue) {
      return localItems;
    }
    if (!daemonItems || daemonItems.length === 0) {
      return EMPTY_ITEMS;
    }
    return projectDaemonQueueItems(daemonItems, localItems);
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
      const send = async () => {
        // The draft is cleared before enqueue resolves. Keep images rooted while
        // that request is in flight, then replace this temporary key with the
        // daemon's real queue-entry id.
        const pendingId = `pending:${++pendingSidecarSequence.current}`;
        if (attachments.length > 0) {
          setQueuedMessages(serverId, (previous) => {
            const next = new Map(previous);
            next.set(agentId, [...(next.get(agentId) ?? []), { id: pendingId, text, attachments }]);
            return next;
          });
        }
        const wirePayload = splitComposerAttachmentsForSubmit(attachments);
        try {
          const images = await encodeImages(wirePayload.images);
          const result = await client.sendAgentMessage(agentId, text, {
            delivery: "queue",
            images: images ?? [],
            attachments: wirePayload.attachments,
          });
          if (attachments.length > 0) {
            setQueuedMessages(serverId, (previous) => {
              const next = new Map(previous);
              const current = (next.get(agentId) ?? []).filter((item) => item.id !== pendingId);
              if (result.queuedMessageId) {
                current.push({ id: result.queuedMessageId, text, attachments });
              }
              if (current.length === 0) {
                next.delete(agentId);
              } else {
                next.set(agentId, current);
              }
              return next;
            });
          }
        } catch (error) {
          if (attachments.length > 0) {
            setQueuedMessages(serverId, (previous) => {
              const next = new Map(previous);
              const current = (next.get(agentId) ?? []).filter((item) => item.id !== pendingId);
              if (current.length === 0) {
                next.delete(agentId);
              } else {
                next.set(agentId, current);
              }
              return next;
            });
          }
          throw error;
        }
      };
      const started = send();
      // The tracked copy swallows the failure so settling never throws and
      // never becomes a second unhandled rejection; the caller still gets the
      // real promise back and reports the error.
      const tracked = started.catch(() => {});
      inFlightEnqueues.current.add(tracked);
      void tracked.finally(() => {
        inFlightEnqueues.current.delete(tracked);
      });
      await started;
    },
    [agentId, client, daemonOwnsQueue, encodeImages, queueWriter, serverId, setQueuedMessages],
  );

  const take = useCallback(
    async (id: string): Promise<ComposerQueueItem | null> => {
      // Taking a row the user queued a moment ago must hand back its
      // attachments, not the empty array the sidecar holds until the send
      // answers. Covers edit and "Send now" as well as "Send all".
      await settleEnqueues();
      if (!daemonOwnsQueue) {
        const result = editQueuedComposerMessage({ agentId, messageId: id, queue: queueWriter });
        return result ? { id, text: result.text, attachments: result.attachments } : null;
      }
      if (!client) {
        throw new Error("Not connected");
      }
      // The daemon broadcasts the removal before answering this RPC. Read the
      // sidecar first so reconciliation cannot clean up the image while the
      // edit request is still in flight.
      const attachments =
        queueWriter.read(agentId).find((item) => item.id === id)?.attachments ?? [];
      const removed = await client.removeQueuedAgentMessage(agentId, id);
      if (!removed) {
        return null;
      }
      setQueuedMessages(serverId, (previous) => {
        const next = new Map(previous);
        const current = (next.get(agentId) ?? []).filter((item) => item.id !== id);
        if (current.length === 0) {
          next.delete(agentId);
        } else {
          next.set(agentId, current);
        }
        return next;
      });
      return { id: removed.id, text: removed.text, attachments };
    },
    [agentId, client, daemonOwnsQueue, queueWriter, serverId, setQueuedMessages, settleEnqueues],
  );

  /**
   * What "Send all" should pull, read live: settle the enqueues in flight,
   * then re-read the queue from the store rather than the rendered snapshot,
   * which a sidecar write cannot invalidate (it is a ref, by design - the
   * sidecar is incidental cache, not UI truth).
   *
   * The client-held queue has no sidecar and no such lag, but goes through the
   * same call so both paths answer the question the same way.
   */
  const listSendable = useCallback(async (): Promise<readonly ComposerQueueItem[]> => {
    await settleEnqueues();
    if (!daemonOwnsQueue) {
      return queueWriter.read(agentId).filter(isSendableAsUserTurn);
    }
    const entries =
      useSessionStore.getState().sessions[serverId]?.agents?.get(agentId)?.queuedMessages ?? [];
    return projectDaemonQueueItems(entries, queueWriter.read(agentId)).filter(isSendableAsUserTurn);
  }, [agentId, daemonOwnsQueue, queueWriter, serverId, settleEnqueues]);

  // A daemon that owns the queue but predates agent.queue.reorder has no way to
  // move an entry, so the controls are absent rather than faked client-side -
  // the order the daemon holds is the one that runs.
  const canReorder = daemonOwnsQueue ? daemonCanReorder && Boolean(client) : true;

  const move = useCallback(
    async (id: string, direction: "up" | "down") => {
      const from = items.findIndex((item) => item.id === id);
      if (from === -1) {
        return;
      }
      const toIndex = direction === "up" ? from - 1 : from + 1;
      if (toIndex < 0 || toIndex >= items.length) {
        return;
      }
      if (!daemonOwnsQueue) {
        moveQueuedComposerMessage({ agentId, messageId: id, toIndex, queue: queueWriter });
        return;
      }
      if (!client) {
        throw new Error("Not connected");
      }
      await client.reorderQueuedAgentMessage(agentId, id, toIndex);
    },
    [agentId, client, daemonOwnsQueue, items, queueWriter],
  );

  return { items, enqueue, take, listSendable, move: canReorder ? move : null };
}
