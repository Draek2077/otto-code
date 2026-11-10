import { expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import type { StreamItem } from "@/types/stream";
import {
  createVisualizerFeed,
  type VisualizerFeedState,
  type VisualizerSourceSession,
} from "./feed-owner";
import { VisualizerBridge } from "./transport";
import {
  parseVisualizerFrame,
  visualizerFrame,
  type VisualizerCommand,
} from "@getpaseo/visualizer/contracts";
function agent(id = "root", workspaceId = "workspace", parentAgentId: string | null = null): Agent {
  return {
    id,
    workspaceId,
    parentAgentId,
    serverId: "host",
    provider: "claude",
    status: "running",
    turn: { phase: "open", turnId: "turn", startedAt: new Date(1000), cancellationRequestId: null },
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    lastUserMessageAt: null,
    lastActivityAt: new Date(2000),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: "Session",
    cwd: "/repo",
    model: "model",
    labels: {},
  };
}
function fixture(demo = false, selection?: () => { selectedId: string | null; follow: boolean }) {
  const frames: VisualizerCommand[] = [],
    states: VisualizerFeedState[] = [],
    held = new Map<string, string[]>();
  const storeListeners = new Set<() => void>(),
    layoutListeners = new Set<() => void>(),
    timelineListeners = new Set<() => void>();
  let status: "pending" | "ready" = "pending";
  let tabs: WorkspaceTab[] = [
    { tabId: "chat", target: { kind: "agent", agentId: "root" }, createdAt: 1000 },
  ];
  const session: VisualizerSourceSession = {
    client: { isConnected: true },
    clientGeneration: 1,
    hasHydratedAgents: true,
    agents: new Map([["root", agent()]]),
    agentDetails: new Map(),
    focusedAgentId: "root",
    agentStreamTail: new Map(),
    agentStreamHead: new Map(),
    viewedTimelineSync: {
      getAgentTimelineStatus: () => status,
      replaceBackgroundAgentIds(source, ids) {
        if (ids.length) held.set(source, ids);
        else held.delete(source);
      },
      subscribe(listener) {
        timelineListeners.add(listener);
        return () => {
          timelineListeners.delete(listener);
        };
      },
    },
  };
  const bridge = new VisualizerBridge("fixture-channel", () => {});
  bridge.attach((raw) => {
    const command = parseVisualizerFrame(raw, bridge.channel);
    if (!command) throw new Error("Invalid production frame");
    frames.push(command);
  });
  bridge.accept(visualizerFrame(bridge.channel, { type: "ready" }));
  const release = createVisualizerFeed(
    "workspace",
    bridge,
    (state) => states.push(state),
    {
      readSession: () => session,
      readTabs: () => tabs,
      subscribe(listener) {
        storeListeners.add(listener);
        return () => {
          storeListeners.delete(listener);
        };
      },
      subscribeLayout(listener) {
        layoutListeners.add(listener);
        return () => {
          layoutListeners.delete(listener);
        };
      },
    },
    demo,
    selection,
  );
  const notify = () => {
    for (const listener of [...storeListeners, ...layoutListeners, ...timelineListeners])
      listener();
  };
  const reply = (text: string) => {
    status = "ready";
    const row: StreamItem = {
      kind: "assistant_message",
      id: "reply",
      text,
      timestamp: new Date(2000),
    };
    session.agentStreamTail.set("root", [row]);
    notify();
  };
  return {
    session,
    held,
    frames,
    states,
    bridge,
    release,
    reply,
    notify,
    setTabs(next: WorkspaceTab[]) {
      tabs = next;
      notify();
    },
    listeners: () => storeListeners.size + layoutListeners.size + timelineListeners.size,
  };
}
function events(frames: VisualizerCommand[]) {
  return frames.flatMap((frame) => (frame.type === "agent-event-batch" ? frame.events : []));
}
it("registers root and shared demand before history, then hydrates the real reply once", async () => {
  const host = fixture();
  expect(host.held.get("otto:visualizer:fixture-channel")).toEqual(["root"]);
  expect(events(host.frames).filter((event) => event.type === "agent_spawn")).toHaveLength(1);
  expect(host.states.at(-1)?.sessions.map((session) => session.id)).toEqual(["root"]);
  host.reply("Canonical history");
  await Promise.resolve();
  expect(events(host.frames).filter((event) => event.type === "message")).toEqual([
    expect.objectContaining({
      hydrate: true,
      payload: {
        agent: "root",
        role: "assistant",
        content: "Canonical history",
        messageId: "reply",
      },
    }),
  ]);
  const count = host.frames.length;
  host.notify();
  await Promise.resolve();
  expect(host.frames).toHaveLength(count);
  host.release();
  expect(host.listeners()).toBe(0);
  expect(host.held.size).toBe(0);
});
it("releases only its own timeline demand and ignores queued work after disposal", async () => {
  const host = fixture();
  host.held.set("otto:speech:root", ["root"]);
  host.notify();
  host.release();
  const count = host.frames.length;
  await Promise.resolve();
  expect(host.frames).toHaveLength(count);
  expect(host.held).toEqual(new Map([["otto:speech:root", ["root"]]]));
  expect(host.listeners()).toBe(0);
});
it("disconnects without stale animations and resets the canonical replay frontier on reconnect", async () => {
  const host = fixture();
  host.reply("Before");
  await Promise.resolve();
  host.session.client = { isConnected: false };
  host.notify();
  await Promise.resolve();
  expect(host.held.size).toBe(0);
  expect(host.frames).toContainEqual({ type: "config", config: { paused: true } });
  const offset = host.frames.length;
  host.session.client = { isConnected: true };
  host.session.clientGeneration = 2;
  host.reply("After");
  await Promise.resolve();
  const frames = host.frames.slice(offset);
  expect(frames[0]).toEqual({ type: "reset", reason: "canonical-frontier" });
  expect(events(frames).filter((event) => event.type === "message")).toEqual([
    expect.objectContaining({
      hydrate: true,
      payload: { agent: "root", role: "assistant", content: "After", messageId: "reply" },
    }),
  ]);
  host.release();
});
it("includes real Paseo children but excludes another workspace's open chats", async () => {
  const host = fixture();
  host.session.agents.set("child", agent("child", "workspace", "root"));
  host.session.agents.set("foreign", agent("foreign", "elsewhere"));
  host.setTabs([
    { tabId: "chat", target: { kind: "agent", agentId: "root" }, createdAt: 1000 },
    { tabId: "foreign", target: { kind: "agent", agentId: "foreign" }, createdAt: 1000 },
  ]);
  await Promise.resolve();
  expect(host.held.get("otto:visualizer:fixture-channel")).toEqual(["root", "child"]);
  const spawned = events(host.frames)
    .filter((event) => event.type === "agent_spawn")
    .map((event) => event.payload.name);
  expect(spawned).toContain("child");
  expect(spawned).not.toContain("foreign");
  host.release();
});
it("clears closed chat graphs while preserving empty-workspace demo eligibility", async () => {
  const host = fixture();
  host.setTabs([]);
  await Promise.resolve();
  expect(host.states.at(-1)).toMatchObject({ sessions: [], openChats: 0, reset: true });
  expect(host.held.size).toBe(0);
  expect(host.frames).toContainEqual({ type: "session-list", sessions: [] });
  host.release();
});
it("keeps live canonical events out of the explicit demo simulation", () => {
  const host = fixture(true);
  expect(events(host.frames)).toEqual([]);
  expect(host.states.at(-1)?.sessions.map((session) => session.id)).toEqual(["root"]);
  host.release();
});
it("retargets focused demand without clearing per-session renderer state", async () => {
  let selectedId: string | null = "root";
  const host = fixture(false, () => ({ selectedId, follow: false }));
  host.session.agents.set("second", agent("second"));
  host.setTabs([
    { tabId: "chat", target: { kind: "agent", agentId: "root" }, createdAt: 1000 },
    { tabId: "second", target: { kind: "agent", agentId: "second" }, createdAt: 1000 },
  ]);
  await Promise.resolve();
  const resets = host.frames.filter((frame) => frame.type === "reset").length;
  selectedId = "second";
  host.release.refresh();
  await Promise.resolve();
  expect(host.held.get("otto:visualizer:fixture-channel")).toEqual(["second"]);
  selectedId = "otto:all-active-chats";
  host.release.refresh();
  await Promise.resolve();
  expect(host.held.get("otto:visualizer:fixture-channel")).toEqual(["root", "second"]);
  expect(host.frames.filter((frame) => frame.type === "reset")).toHaveLength(resets);
  host.release();
});
it("replays a fresh bounded frontier before a large update can overflow guest history", async () => {
  const host = fixture();
  host.reply("Initial");
  await Promise.resolve();
  for (let epoch = 0; epoch < 26; epoch++) {
    host.session.agentStreamTail.set(
      "root",
      Array.from(
        { length: 256 },
        (_, index): StreamItem => ({
          kind: "assistant_message",
          id: `reply-${epoch}-${index}`,
          text: "Canonical reply",
          timestamp: new Date(2000 + epoch),
        }),
      ),
    );
    host.notify();
    await Promise.resolve();
  }
  let count = 0;
  for (const frame of host.frames) {
    if (frame.type === "reset") count = 0;
    if (frame.type === "agent-event-batch") count += frame.events.length;
    expect(count).toBeLessThanOrEqual(6000);
  }
  expect(host.frames.filter((frame) => frame.type === "reset").length).toBeGreaterThan(1);
  expect(events(host.frames).at(-1)?.type).toBe("agent_idle");
  host.release();
});
