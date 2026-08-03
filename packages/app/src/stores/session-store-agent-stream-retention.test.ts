import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { useSessionStore, type Agent } from "./session-store";
import { AGENT_STREAM_MAX_RETAINED_AGENTS } from "@/timeline/agent-stream-retention";
import { useClearedSubagentTokensStore } from "@/subagents/cleared-subagent-tokens-store";
import type { StreamItem } from "@/types/stream";

const SERVER_ID = "retention-server";

function item(text: string): StreamItem {
  return { kind: "assistant_message", id: text, text, timestamp: new Date(0) } as StreamItem;
}

function bufferAgent(agentId: string): void {
  useSessionStore.getState().setAgentStreamState(SERVER_ID, agentId, { tail: [item(agentId)] });
}

function session() {
  const found = useSessionStore.getState().sessions[SERVER_ID];
  if (!found) {
    throw new Error("test session is not initialized");
  }
  return found;
}

function bufferedAgentIds(): string[] {
  return [...session().agentStreamTail.keys()].sort();
}

// Only the id is read by the store; the panel is what interprets the rest.
function detailAgent(agentId: string): Agent {
  return { id: agentId } as Agent;
}

function clearedTokensFor(parentAgentId: string): number {
  return (
    useClearedSubagentTokensStore.getState().byParent.get(`${SERVER_ID}::${parentAgentId}`)
      ?.total ?? 0
  );
}

beforeEach(() => {
  useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
  useClearedSubagentTokensStore.setState({ byParent: new Map() });
});

afterEach(() => {
  useSessionStore.getState().clearSession(SERVER_ID);
});

describe("agent stream retention in the session store", () => {
  it("holds every agent while under the cap", () => {
    for (let index = 0; index < AGENT_STREAM_MAX_RETAINED_AGENTS; index += 1) {
      bufferAgent(`agent-${index}`);
    }

    expect(session().agentStreamTail.size).toBe(AGENT_STREAM_MAX_RETAINED_AGENTS);
  });

  it("evicts down to the cap as new agents start streaming", () => {
    for (let index = 0; index < AGENT_STREAM_MAX_RETAINED_AGENTS + 5; index += 1) {
      bufferAgent(`agent-${String(index).padStart(2, "0")}`);
    }

    expect(session().agentStreamTail.size).toBe(AGENT_STREAM_MAX_RETAINED_AGENTS);
    // Oldest-touched first, so the five earliest agents are the ones gone.
    expect(bufferedAgentIds()).not.toContain("agent-00");
    expect(bufferedAgentIds()).toContain(
      `agent-${String(AGENT_STREAM_MAX_RETAINED_AGENTS + 4).padStart(2, "0")}`,
    );
  });

  // The invariant that makes eviction safe: dropping the buffers must also drop
  // the state that says "already caught up", or the next open issues an `after`
  // catch-up that returns nothing and renders an empty chat.
  it("releasing an agent also clears its cursor and applied-history flag", () => {
    const { setAgentStreamState, setAgentTimelineCursor, setAgentAuthoritativeHistoryApplied } =
      useSessionStore.getState();

    setAgentStreamState(SERVER_ID, "agent-1", { tail: [item("hello")] });
    setAgentTimelineCursor(SERVER_ID, (prev) =>
      new Map(prev).set("agent-1", { epoch: "epoch-1", startSeq: 1, endSeq: 9 }),
    );
    setAgentAuthoritativeHistoryApplied(SERVER_ID, "agent-1", true);

    useSessionStore.getState().releaseAgentStreams(SERVER_ID, ["agent-1"]);

    const current = session();
    expect(current.agentStreamTail.has("agent-1")).toBe(false);
    expect(current.agentTimelineCursor.has("agent-1")).toBe(false);
    expect(current.agentAuthoritativeHistoryApplied.has("agent-1")).toBe(false);
  });

  it("never evicts an agent a mounted surface is retaining", () => {
    bufferAgent("pinned");
    const release = useSessionStore.getState().retainAgentStream(SERVER_ID, "pinned");

    for (let index = 0; index < AGENT_STREAM_MAX_RETAINED_AGENTS + 5; index += 1) {
      bufferAgent(`agent-${String(index).padStart(2, "0")}`);
    }

    expect(bufferedAgentIds()).toContain("pinned");

    // ...and once it unmounts it is just another cached agent — the oldest
    // one, so the next agent to start streaming takes its slot.
    release();
    bufferAgent("newcomer");
    expect(bufferedAgentIds()).not.toContain("pinned");
    expect(bufferedAgentIds()).toContain("newcomer");
  });

  it("ref-counts retainers so a second pane closing does not release the first", () => {
    bufferAgent("shared");
    const releaseA = useSessionStore.getState().retainAgentStream(SERVER_ID, "shared");
    const releaseB = useSessionStore.getState().retainAgentStream(SERVER_ID, "shared");

    releaseA();
    for (let index = 0; index < AGENT_STREAM_MAX_RETAINED_AGENTS + 5; index += 1) {
      bufferAgent(`agent-${String(index).padStart(2, "0")}`);
    }
    expect(bufferedAgentIds()).toContain("shared");

    releaseB();
    bufferAgent("newcomer");
    expect(bufferedAgentIds()).not.toContain("shared");
  });

  it("a repeated release from the same retainer does not double-decrement", () => {
    bufferAgent("shared");
    const releaseA = useSessionStore.getState().retainAgentStream(SERVER_ID, "shared");
    const releaseB = useSessionStore.getState().retainAgentStream(SERVER_ID, "shared");

    releaseA();
    releaseA();

    expect(session().agentStreamRetainers.get("shared")).toBe(1);
    releaseB();
    expect(session().agentStreamRetainers.has("shared")).toBe(false);
  });

  it("releases a departed agent immediately, well under the cap", () => {
    bufferAgent("gone");
    bufferAgent("kept");

    useSessionStore.getState().sweepAgentStreams(SERVER_ID, ["gone"]);

    expect(bufferedAgentIds()).toEqual(["kept"]);
  });

  it("closing the last pane on a chat that is no longer a live agent releases it", () => {
    bufferAgent("closed-chat");
    const release = useSessionStore.getState().retainAgentStream(SERVER_ID, "closed-chat");

    // Never entered `agents` — an archived or deleted chat, not a live one.
    release();

    expect(bufferedAgentIds()).toEqual([]);
  });

  // Every per-agent side map has to travel with the buffers; each one left
  // behind is an entry per agent for the life of the app.
  it("releasing an agent also clears its per-agent side maps", () => {
    const store = useSessionStore.getState();
    bufferAgent("agent-1");
    store.markAgentHistorySynchronized(SERVER_ID, "agent-1");
    store.setAgentPromptSuggestion(SERVER_ID, "agent-1", "Run the tests");
    store.setAgentRateLimit(SERVER_ID, "agent-1", { status: "warning", limitType: "five_hour" });
    store.dismissAgentRateLimit(SERVER_ID, "agent-1");
    store.appendSentPrompt(SERVER_ID, "agent-1", "ship it");

    useSessionStore.getState().releaseAgentStreams(SERVER_ID, ["agent-1"]);

    const current = session();
    expect({
      syncGeneration: current.agentHistorySyncGeneration.has("agent-1"),
      suggestion: current.agentPromptSuggestions.has("agent-1"),
      rateLimit: current.agentRateLimits.has("agent-1"),
      dismissed: current.dismissedRateLimits.has("agent-1"),
      sentPrompts: current.sentPromptHistory.has("agent-1"),
    }).toEqual({
      syncGeneration: false,
      suggestion: false,
      rateLimit: false,
      dismissed: false,
      sentPrompts: false,
    });
  });

  it("closing a chat tab evicts the hydrated snapshot it was opened with", () => {
    const store = useSessionStore.getState();
    store.setAgentDetails(SERVER_ID, new Map([["closed-chat", detailAgent("closed-chat")]]));
    useClearedSubagentTokensStore.getState().recordCleared({
      serverId: SERVER_ID,
      parentAgentId: "closed-chat",
      rows: [{ id: "sub-1", cumulativeTokens: 400 }],
    });

    store.releaseClosedChat(SERVER_ID, "closed-chat");

    expect(session().agentDetails.has("closed-chat")).toBe(false);
    expect(clearedTokensFor("closed-chat")).toBe(0);
  });

  it("keeps the snapshot of a chat that is still in the active directory", () => {
    const store = useSessionStore.getState();
    const live = detailAgent("live-chat");
    store.setAgents(SERVER_ID, new Map([["live-chat", live]]));
    store.setAgentDetails(SERVER_ID, new Map([["live-chat", live]]));
    useClearedSubagentTokensStore.getState().recordCleared({
      serverId: SERVER_ID,
      parentAgentId: "live-chat",
      rows: [{ id: "sub-1", cumulativeTokens: 400 }],
    });

    store.releaseClosedChat(SERVER_ID, "live-chat");

    expect(session().agentDetails.has("live-chat")).toBe(true);
    expect(clearedTokensFor("live-chat")).toBe(400);
  });

  // A pane can unmount (mounted-tab retention, deck eviction) while its tab is
  // still open, and the tab strip renders its title out of `agentDetails`.
  it("unmounting the last pane does not evict the snapshot", () => {
    const store = useSessionStore.getState();
    bufferAgent("background-chat");
    store.setAgentDetails(
      SERVER_ID,
      new Map([["background-chat", detailAgent("background-chat")]]),
    );
    const release = useSessionStore.getState().retainAgentStream(SERVER_ID, "background-chat");

    release();

    expect(bufferedAgentIds()).toEqual([]);
    expect(session().agentDetails.has("background-chat")).toBe(true);
  });

  it("keeps a departed agent that is still on screen", () => {
    bufferAgent("gone");
    useSessionStore.getState().retainAgentStream(SERVER_ID, "gone");

    useSessionStore.getState().sweepAgentStreams(SERVER_ID, ["gone"]);

    expect(bufferedAgentIds()).toEqual(["gone"]);
  });
});
