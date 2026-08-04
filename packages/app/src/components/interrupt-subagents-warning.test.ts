import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { afterEach, describe, expect, it } from "vitest";
import { countLiveObservedSubagents } from "./interrupt-subagents-warning";
import { useSessionStore, type Agent } from "@/stores/session-store";

const SERVER_ID = "server-1";
const PARENT_ID = "chat";
const AGENT_TIMESTAMP = new Date("2026-07-30T10:00:00.000Z");

const AGENT_DEFAULTS: Agent = {
  serverId: SERVER_ID,
  id: "agent",
  provider: "claude",
  status: "idle",
  createdAt: AGENT_TIMESTAMP,
  updatedAt: AGENT_TIMESTAMP,
  lastUserMessageAt: null,
  lastActivityAt: AGENT_TIMESTAMP,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
  currentModeId: null,
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  runtimeInfo: undefined,
  lastUsage: undefined,
  lastError: null,
  title: "Agent",
  cwd: "/tmp/project",
  model: null,
  features: undefined,
  thinkingOptionId: undefined,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function makeAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return { ...AGENT_DEFAULTS, ...input };
}

function setAgents(agents: Agent[]): void {
  useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
  useSessionStore
    .getState()
    .setAgents(SERVER_ID, new Map(agents.map((agent) => [agent.id, agent])));
}

afterEach(() => {
  useSessionStore.getState().clearSession(SERVER_ID);
});

describe("countLiveObservedSubagents", () => {
  it("counts foreground observed rows, which the interrupt really does stop", () => {
    setAgents([
      makeAgent({ id: PARENT_ID, status: "running" }),
      makeAgent({
        id: "foreground-a",
        parentAgentId: PARENT_ID,
        attend: "observed",
        status: "running",
      }),
      makeAgent({
        id: "foreground-b",
        parentAgentId: PARENT_ID,
        attend: "observed",
        status: "initializing",
      }),
    ]);

    expect(countLiveObservedSubagents(SERVER_ID, PARENT_ID)).toBe(2);
  });

  // The bug this file exists for: a backgrounded run keeps going after the
  // parent's turn is interrupted, so warning that it will be stopped is a lie.
  it("ignores backgrounded runs, which survive the interrupt", () => {
    setAgents([
      makeAgent({ id: PARENT_ID, status: "running" }),
      makeAgent({
        id: "backgrounded",
        parentAgentId: PARENT_ID,
        attend: "observed",
        status: "running",
        backgrounded: true,
      }),
    ]);

    expect(countLiveObservedSubagents(SERVER_ID, PARENT_ID)).toBe(0);
  });

  it("ignores rows nested under a backgrounded run", () => {
    setAgents([
      makeAgent({ id: PARENT_ID, status: "running" }),
      makeAgent({
        id: "workflow",
        parentAgentId: PARENT_ID,
        attend: "observed",
        status: "running",
        backgrounded: true,
      }),
      // The daemon inherits the flag down the tree; the client just reads it.
      makeAgent({
        id: "workflow-child",
        parentAgentId: "workflow",
        attend: "observed",
        status: "running",
        backgrounded: true,
      }),
    ]);

    expect(countLiveObservedSubagents(SERVER_ID, PARENT_ID)).toBe(0);
  });

  it("ignores attended children and terminal rows", () => {
    setAgents([
      makeAgent({ id: PARENT_ID, status: "running" }),
      // Its own chat, spawned with create_agent - never touched by the parent's
      // interrupt.
      makeAgent({ id: "attended", parentAgentId: PARENT_ID, status: "running" }),
      makeAgent({
        id: "finished",
        parentAgentId: PARENT_ID,
        attend: "observed",
        status: "idle",
      }),
      makeAgent({
        id: "failed",
        parentAgentId: PARENT_ID,
        attend: "observed",
        status: "error",
      }),
    ]);

    expect(countLiveObservedSubagents(SERVER_ID, PARENT_ID)).toBe(0);
  });
});
