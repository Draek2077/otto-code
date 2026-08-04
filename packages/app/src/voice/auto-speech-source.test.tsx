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
  return { kind: "user_message", id, text: id, timestamp: new Date(0) };
}

function assistant(groupId: string, blockIndex: number, text: string, live = false): StreamItem {
  return {
    kind: "assistant_message",
    id: live ? `${groupId}:head` : `${groupId}:block:${blockIndex}`,
    text,
    timestamp: new Date(0),
    blockGroupId: groupId,
    blockIndex,
  };
}

function setStatus(status: Agent["status"]): void {
  useSessionStore.getState().setAgents(SERVER, (prev) => {
    const next = new Map(prev);
    next.set(AGENT, { ...(next.get(AGENT) as Agent), id: AGENT, serverId: SERVER, status });
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
});
