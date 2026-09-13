/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { useSessionStore, type Agent } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { autoSpeechQueue } from "@/voice/auto-speech-queue";
import { ChatAutoSpeechSource } from "@/voice/auto-speech-source";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

const SERVER = "host-1";
const AGENT = "agent-1";

function user(id: string): StreamItem {
  return {
    kind: "user_message",
    id,
    text: id,
    turnId: id === "u2" ? "turn2" : "turn1",
    timestamp: new Date(0),
  };
}

function assistant(
  groupId: string,
  blockIndex: number,
  text: string,
  live = false,
  turnId = "turn1",
): StreamItem {
  return {
    kind: "assistant_message",
    turnId,
    id: live ? `${groupId}:head` : `${groupId}:block:${blockIndex}`,
    text,
    timestamp: new Date(0),
    blockGroupId: groupId,
    blockIndex,
  };
}

function setStatus(
  status: Agent["status"],
  turnId: string | null = status === "running" ? "turn1" : null,
): void {
  useSessionStore.getState().setAgents(SERVER, (prev) => {
    const next = new Map(prev);
    next.set(AGENT, {
      ...(next.get(AGENT) as Agent),
      id: AGENT,
      serverId: SERVER,
      status,
      turn:
        turnId === null
          ? { phase: "idle", cancellationRequestId: null }
          : { phase: "open", turnId, startedAt: new Date(0), cancellationRequestId: null },
    });
    return next;
  });
}

function setStream(state: { tail?: StreamItem[]; head?: StreamItem[] }): void {
  useSessionStore.getState().setAgentStreamState(SERVER, AGENT, state);
}

let root: Root;
let container: HTMLDivElement;
const spoken: string[] = [];

function mount(): void {
  act(() => {
    root.render(<ChatAutoSpeechSource serverId={SERVER} agentId={AGENT} />);
  });
}

beforeEach(() => {
  spoken.length = 0;
  useSessionStore.getState().initializeSession(SERVER, null as unknown as DaemonClient);
  autoSpeechQueue.resetForTests();
  autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);
  autoSpeechQueue.registerSpeaker(SERVER, {
    speak(item) {
      spoken.push(item.text);
      return Promise.resolve();
    },
    stop() {},
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  autoSpeechQueue.resetForTests();
  useSessionStore.getState().clearSession(SERVER);
});

describe("ChatAutoSpeechSource", () => {
  it("reads a reply paragraph by paragraph while the chat is not on screen", async () => {
    // Nothing here renders the chat - that is the point. The source is mounted
    // on its own and the queue still fills.
    setStream({ tail: [user("u1")] });
    setStatus("running");
    mount();

    await act(async () => {
      setStream({ head: [assistant("g1", 0, "first"), assistant("g1", 1, "second", true)] });
    });
    expect(spoken).toEqual(["first"]);

    // The turn ends: the paragraph the model was still writing is finished too.
    await act(async () => {
      setStream({ tail: [user("u1"), assistant("g1", 0, "first"), assistant("g1", 1, "second")] });
      setStream({ head: [] });
      setStatus("idle");
    });
    expect(spoken).toEqual(["first", "second"]);
  });

  it("never recites history that lands after it mounts", async () => {
    // The failure this pins: the source mounts against empty buffers (its chat
    // has not been opened yet), and the timeline arrives later - as a history
    // page, a reconnect replay, or a catch-up after eviction. A watermark taken
    // at mount would have read the whole chat aloud.
    setStatus("idle");
    mount();

    await act(async () => {
      setStream({
        tail: [
          user("u1"),
          assistant("g1", 0, "old answer"),
          user("u2"),
          assistant("g2", 0, "newer answer"),
        ],
      });
    });

    expect(spoken).toEqual([]);
  });

  it("arms mid-reply without reading the half already written", async () => {
    setStream({
      tail: [user("u1")],
      head: [assistant("g1", 0, "already said"), assistant("g1", 1, "still writ", true)],
    });
    setStatus("running");
    mount();

    await act(async () => {
      setStream({
        head: [
          assistant("g1", 0, "already said"),
          assistant("g1", 1, "still writing"),
          assistant("g1", 2, "and more", true),
        ],
      });
    });

    expect(spoken).toEqual(["still writing"]);
  });

  it("follows explicit turn liveness when status disagrees", async () => {
    setStream({ tail: [user("u1")] });
    setStatus("idle", "turn1");
    mount();
    await act(async () => {
      setStream({ head: [assistant("g1", 0, "first"), assistant("g1", 1, "second", true)] });
    });
    expect(spoken).toEqual(["first"]);
    await act(async () => {
      setStatus("running", null);
    });
    expect(spoken).toEqual(["first", "second"]);
  });

  it("flushes the observed turn when the next turn opens without an intermediate idle snapshot", async () => {
    setStream({ tail: [user("u1")] });
    setStatus("running");
    mount();
    await act(async () => {
      setStream({ head: [assistant("g1", 0, "last paragraph", true)] });
    });
    expect(spoken).toEqual([]);
    await act(async () => {
      setStream({ tail: [user("u1"), assistant("g1", 0, "last paragraph"), user("u2")], head: [] });
      setStatus("running", "turn2");
    });
    expect(spoken).toEqual(["last paragraph"]);
    await act(async () => {
      setStream({ head: [assistant("g2", 0, "new reply", true, "turn2")] });
      setStatus("idle");
    });
    expect(spoken).toEqual(["last paragraph", "new reply"]);
  });

  it("seeds a running reconnect snapshot before reading newly completed paragraphs", async () => {
    setStatus("running");
    mount();
    await act(async () => {
      setStream({
        tail: [user("u1"), assistant("g1", 0, "before reconnect")],
        head: [assistant("g1", 1, "still writing", true)],
      });
    });
    expect(spoken).toEqual([]);
    await act(async () => {
      setStatus("idle");
    });
    expect(spoken).toEqual(["still writing"]);
  });

  it("does not read a finished reply again when a later submission only changes status", async () => {
    setStream({ tail: [user("u1")] });
    setStatus("running");
    mount();
    await act(async () => {
      setStream({ head: [assistant("g1", 0, "finished reply", true)] });
      setStatus("idle");
    });
    expect(spoken).toEqual(["finished reply"]);
    await act(async () => {
      setStatus("running", null);
    });
    expect(spoken).toEqual(["finished reply"]);
  });
});
