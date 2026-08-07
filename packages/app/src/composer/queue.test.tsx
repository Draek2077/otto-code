/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueuedAgentMessagePayload } from "@otto-code/protocol/messages";

import type { ComposerAttachment } from "@/attachments/types";
import { useSessionStore } from "@/stores/session-store";
import type { DaemonClient } from "@otto-code/client";
import { useComposerQueue, type ComposerQueueItem } from "./queue";

const SERVER_ID = "server-1";
const AGENT_ID = "agent-1";
const ENTRY_ID = "entry-1";
const ENQUEUED_AT = "2026-08-03T00:00:00.000Z";

const FILE_ATTACHMENT: ComposerAttachment = {
  kind: "file",
  attachment: {
    type: "uploaded_file",
    id: "file-1",
    fileName: "notes.md",
    mimeType: "text/markdown",
    size: 12,
    path: "/tmp/notes.md",
  },
};

const IMAGE_ATTACHMENT: ComposerAttachment = {
  kind: "image",
  metadata: {
    id: "att-image-1",
    mimeType: "image/png",
    storageType: "web-indexeddb",
    storageKey: "att-image-1",
    createdAt: 0,
  },
};

function entry(overrides: Partial<QueuedAgentMessagePayload> = {}): QueuedAgentMessagePayload {
  return { id: ENTRY_ID, preview: "queued", enqueuedAt: ENQUEUED_AT, ...overrides };
}

function seedSession(options: { steerQueue: boolean }): void {
  useSessionStore.setState({
    sessions: {
      [SERVER_ID]: {
        serverId: SERVER_ID,
        client: null,
        serverInfo: { features: options.steerQueue ? { steerQueue: true } : {} },
        agents: new Map(),
        queuedMessages: new Map(),
      },
    },
  } as never);
}

/** What the daemon's `agent_state` broadcast does to the client's store. */
function broadcastQueueEntries(entries: QueuedAgentMessagePayload[]): void {
  useSessionStore.setState(((prev: { sessions: Record<string, unknown> }) => ({
    sessions: {
      ...prev.sessions,
      [SERVER_ID]: {
        ...(prev.sessions[SERVER_ID] as object),
        agents: new Map([[AGENT_ID, { id: AGENT_ID, queuedMessages: entries }]]),
      },
    },
  })) as never);
}

function renderQueue(client: Partial<DaemonClient>) {
  return renderHook(() =>
    useComposerQueue({
      serverId: SERVER_ID,
      agentId: AGENT_ID,
      client: client as DaemonClient,
      encodeImages: async () => [],
    }),
  );
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Pins the ordering the bug lives in, rather than hoping for it: the daemon
 * broadcasts the new entry from inside `enqueueSteerMessage`, BEFORE it answers
 * the send - so the client always learns the row exists a tick before it learns
 * the entry id it must file the attachments under. Here the send does not answer
 * until the test says so, and `reached` lets the test wait for the broadcast
 * without a timer.
 */
function installRacingSend(entryIds: string[]) {
  const answers = entryIds.map(() => deferred<{ queuedMessageId: string }>());
  const reached = entryIds.map(() => deferred<void>());
  let call = 0;

  const sendAgentMessage = vi.fn(async () => {
    const index = call++;
    broadcastQueueEntries(
      entryIds.slice(0, index + 1).map((id) => entry({ id, attachmentCount: 1 })),
    );
    reached[index]!.resolve();
    return await answers[index]!.promise;
  });

  return {
    client: { sendAgentMessage } as unknown as Partial<DaemonClient>,
    reached: (index: number) => reached[index]!.promise,
    answer: (index: number) => answers[index]!.resolve({ queuedMessageId: entryIds[index]! }),
  };
}

afterEach(() => {
  cleanup();
  useSessionStore.setState({ sessions: {} } as never);
});

describe("useComposerQueue - the daemon broadcast beats the sidecar write", () => {
  it("still sends a row whose attachments have not reached the sidecar yet", async () => {
    seedSession({ steerQueue: true });
    const send = installRacingSend([ENTRY_ID]);
    const { result } = renderQueue(send.client);

    let enqueued!: Promise<void>;
    await act(async () => {
      enqueued = result.current.enqueue("look at this", [FILE_ATTACHMENT]);
      await send.reached(0);
    });

    // The bad ordering, made explicit: the row is on screen and reports the
    // daemon's attachment count, but this client's copy is still empty, and no
    // re-render is coming to fix it.
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.attachmentCount).toBe(1);
    expect(result.current.items[0]?.attachments).toEqual([]);

    let pending!: Promise<readonly ComposerQueueItem[]>;
    await act(async () => {
      pending = result.current.listSendable();
      send.answer(0);
      await enqueued;
    });
    const sendable = await pending;

    expect(sendable.map((item) => item.id)).toEqual([ENTRY_ID]);
    expect(sendable[0]?.attachments).toEqual([FILE_ATTACHMENT]);
  });

  it("keeps an image rooted until an edit takes it back out of the daemon queue", async () => {
    seedSession({ steerQueue: true });
    const send = installRacingSend([ENTRY_ID]);
    const removeQueuedAgentMessage = vi.fn(async () => {
      // The daemon's removal broadcast may reconcile the sidecar before its
      // RPC response reaches the edit handler.
      broadcastQueueEntries([]);
      await Promise.resolve();
      return { id: ENTRY_ID, text: "look at this" };
    });
    const { result } = renderQueue({ ...send.client, removeQueuedAgentMessage } as never);

    let enqueued!: Promise<void>;
    await act(async () => {
      enqueued = result.current.enqueue("look at this", [IMAGE_ATTACHMENT]);
      await send.reached(0);
    });

    // Queueing clears the draft immediately, so the session-held sidecar is
    // now the image's GC root until the queue entry is edited or delivered.
    expect(
      useSessionStore.getState().sessions[SERVER_ID]?.queuedMessages.get(AGENT_ID)?.[0]
        ?.attachments,
    ).toEqual([IMAGE_ATTACHMENT]);

    let pending!: Promise<ComposerQueueItem | null>;
    await act(async () => {
      pending = result.current.take(ENTRY_ID);
      send.answer(0);
      await enqueued;
    });
    const taken = await pending;

    expect(taken).not.toBeNull();
    expect(taken?.attachments).toEqual([IMAGE_ATTACHMENT]);
    expect(
      useSessionStore.getState().sessions[SERVER_ID]?.queuedMessages.get(AGENT_ID),
    ).toBeUndefined();
  });

  it("waits for an enqueue that starts while it is already settling", async () => {
    seedSession({ steerQueue: true });
    const send = installRacingSend(["entry-1", "entry-2"]);
    const { result } = renderQueue(send.client);

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.enqueue("first", [FILE_ATTACHMENT]);
      await send.reached(0);
    });

    let pending!: Promise<readonly ComposerQueueItem[]>;
    await act(async () => {
      pending = result.current.listSendable();
      // Settling the first enqueue opens the door for a second one, which must
      // also be waited for rather than raced past.
      send.answer(0);
      await first;
      const second = result.current.enqueue("second", [FILE_ATTACHMENT]);
      await send.reached(1);
      send.answer(1);
      await second;
    });
    const sendable = await pending;

    expect(sendable.map((item) => item.id)).toEqual(["entry-1", "entry-2"]);
    expect(sendable.every((item) => item.attachments.length === 1)).toBe(true);
  });
});

describe("useComposerQueue - what 'Send all' must still leave behind", () => {
  it("leaves an entry whose attachments this client genuinely never had", async () => {
    seedSession({ steerQueue: true });
    const { result } = renderQueue({});

    await act(async () => {
      // A reload or another device: the daemon holds two files, the sidecar is
      // empty and no enqueue is in flight to fill it.
      broadcastQueueEntries([entry({ preview: "from another device", attachmentCount: 2 })]);
    });

    expect(result.current.items).toHaveLength(1);
    await expect(result.current.listSendable()).resolves.toEqual([]);
  });

  it("leaves system-injected entries out of the merged turn", async () => {
    seedSession({ steerQueue: true });
    const { result } = renderQueue({});

    await act(async () => {
      broadcastQueueEntries([
        entry({
          id: "entry-system",
          preview: "<otto-system>a schedule fired</otto-system>",
          source: "system",
        }),
        entry({ preview: "mine", source: "user" }),
      ]);
    });

    const sendable = await result.current.listSendable();
    expect(sendable.map((item) => item.id)).toEqual([ENTRY_ID]);
  });
});

describe("useComposerQueue - the client-held queue", () => {
  it("answers the same question with no sidecar and no race", async () => {
    seedSession({ steerQueue: false });
    const { result } = renderQueue({});

    await act(async () => {
      await result.current.enqueue("local one", [FILE_ATTACHMENT]);
    });

    expect(result.current.items).toHaveLength(1);
    const sendable = await result.current.listSendable();
    expect(sendable).toHaveLength(1);
    expect(sendable[0]?.text).toBe("local one");
    expect(sendable[0]?.attachments).toEqual([FILE_ATTACHMENT]);
  });
});
