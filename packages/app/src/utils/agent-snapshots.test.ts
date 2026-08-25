import { describe, expect, it } from "vitest";
import type { AgentSnapshotPayload } from "@otto-code/protocol/messages";
import { PARENT_AGENT_ID_LABEL } from "@otto-code/protocol/agent-labels";
import { normalizeAgentActiveTurn, normalizeAgentSnapshot } from "./agent-snapshots";

// Identity rides through only when a case sets it, so "neither spelling present"
// stays a real case rather than a defaulted one.
const IDENTITY_KEYS = [
  "personalityId",
  "personalityName",
  "personalitySpinner",
  "agentProfileId",
  "agentProfileName",
  "agentProfileSpinner",
] as const;

function pickIdentity(input: Record<string, unknown>): Partial<AgentSnapshotPayload> {
  const out: Record<string, unknown> = {};
  for (const key of IDENTITY_KEYS) {
    if (input[key] !== undefined) {
      out[key] = input[key];
    }
  }
  return out as Partial<AgentSnapshotPayload>;
}

function createSnapshot(
  input: Partial<Omit<AgentSnapshotPayload, "labels">> & {
    labels?: Record<string, unknown>;
  } = {},
): AgentSnapshotPayload {
  return {
    id: input.id ?? "agent-1",
    provider: input.provider ?? "codex",
    cwd: input.cwd ?? "/repo",
    model: input.model ?? null,
    createdAt: input.createdAt ?? "2026-04-20T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-20T00:01:00.000Z",
    lastUserMessageAt: input.lastUserMessageAt ?? null,
    status: input.status ?? "idle",
    activeTurn: input.activeTurn,
    capabilities: input.capabilities ?? {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: input.currentModeId ?? null,
    availableModes: input.availableModes ?? [],
    pendingPermissions: input.pendingPermissions ?? [],
    persistence: input.persistence ?? null,
    title: input.title ?? null,
    labels: (input.labels ?? {}) as AgentSnapshotPayload["labels"],
    ...pickIdentity(input),
  };
}

describe("normalizeAgentSnapshot", () => {
  it("normalizes identified and legacy active turns separately from the agent replica", () => {
    const startedAt = "2026-07-31T12:00:00.000Z";
    const identified = createSnapshot({
      status: "running",
      activeTurn: { turnId: "turn-1", startedAt },
    });
    expect(normalizeAgentActiveTurn(identified, new Date(startedAt))).toEqual({
      turnId: "turn-1",
      startedAt: new Date(startedAt),
    });

    const legacy = createSnapshot({ status: "running", lastUserMessageAt: startedAt });
    expect(normalizeAgentActiveTurn(legacy, new Date(startedAt))).toEqual({
      turnId: null,
      startedAt: new Date(startedAt),
    });

    expect(normalizeAgentSnapshot(identified, "server-1")).not.toHaveProperty("activeTurn");
  });

  it("derives parentAgentId from the parent label while preserving labels", () => {
    const labels = {
      [PARENT_AGENT_ID_LABEL]: "parent-1",
      "custom.label": "still-here",
    };

    const agent = normalizeAgentSnapshot(createSnapshot({ labels }), "server-1");

    expect(agent.parentAgentId).toBe("parent-1");
    expect(agent.labels).toEqual(labels);
  });

  it("trims whitespace around the parent label", () => {
    const agent = normalizeAgentSnapshot(
      createSnapshot({ labels: { [PARENT_AGENT_ID_LABEL]: "  parent-1 \n" } }),
      "server-1",
    );

    expect(agent.parentAgentId).toBe("parent-1");
  });

  it("maps missing, empty, and non-string parent labels to null", () => {
    const missing = normalizeAgentSnapshot(createSnapshot(), "server-1");
    const empty = normalizeAgentSnapshot(
      createSnapshot({ labels: { [PARENT_AGENT_ID_LABEL]: "   " } }),
      "server-1",
    );
    const nonString = normalizeAgentSnapshot(
      createSnapshot({ labels: { [PARENT_AGENT_ID_LABEL]: 42 } }),
      "server-1",
    );

    expect(missing.parentAgentId).toBeNull();
    expect(empty.parentAgentId).toBeNull();
    expect(nonString.parentAgentId).toBeNull();
  });
});

// COMPAT(agentProfileFields): added in v0.8.13, remove after 2027-02-22.
// The daemon emits the identity under both spellings. Preferring the current one
// happens here, at the single ingestion point, so no reader downstream has to
// know there were ever two.
describe("normalizeAgentSnapshot agent profile identity", () => {
  const SPINNER = { glowA: "#111", glowB: "#222" };

  it("prefers the profile-named fields", () => {
    const agent = normalizeAgentSnapshot(
      createSnapshot({
        agentProfileId: "p-new",
        agentProfileName: "New",
        agentProfileSpinner: SPINNER,
        personalityId: "p-old",
        personalityName: "Old",
        personalitySpinner: { glowA: "#333", glowB: "#444" },
      }),
      "server-1",
    );

    expect(agent.personalityId).toBe("p-new");
    expect(agent.personalityName).toBe("New");
    expect(agent.personalitySpinner).toEqual(SPINNER);
  });

  it("falls back to the legacy fields from a daemon that predates the rename", () => {
    const agent = normalizeAgentSnapshot(
      createSnapshot({
        personalityId: "p-old",
        personalityName: "Old",
        personalitySpinner: SPINNER,
      }),
      "server-1",
    );

    expect(agent.personalityId).toBe("p-old");
    expect(agent.personalityName).toBe("Old");
    expect(agent.personalitySpinner).toEqual(SPINNER);
  });

  it("reports no identity when neither spelling is present", () => {
    const agent = normalizeAgentSnapshot(createSnapshot(), "server-1");

    expect(agent.personalityId).toBeNull();
    expect(agent.personalityName).toBeNull();
    expect(agent.personalitySpinner).toBeNull();
  });
});
