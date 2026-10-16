import { describe, expect, it } from "vitest";
import { AgentDirectoryFilterSchema } from "./agent-history.js";
import { FetchAgentsRequestMessageSchema, ServerInfoStatusPayloadSchema } from "./messages.js";
import { validateWSOutboundMessage } from "./validation/ws-outbound.js";

describe("agent workspace filter compatibility", () => {
  it("keeps old requests unchanged and accepts an optional exact workspace ID", () => {
    const legacy = {
      type: "fetch_agents_request",
      requestId: "req-1",
      scope: "active",
      filter: { projectKeys: ["proj-1"] },
    };
    expect(FetchAgentsRequestMessageSchema.parse(legacy)).toEqual(legacy);
    expect(
      FetchAgentsRequestMessageSchema.parse({
        ...legacy,
        filter: { ...legacy.filter, workspaceId: "ws-2" },
      }).filter,
    ).toEqual({
      projectKeys: ["proj-1"],
      workspaceId: "ws-2",
    });
    // An older reader still accepts new requests, ignoring the unknown field.
    expect(
      AgentDirectoryFilterSchema.omit({ workspaceId: true }).parse({
        projectKeys: ["proj-1"],
        workspaceId: "ws-2",
      }),
    ).toEqual(legacy.filter);
  });

  it("accepts old server info and the additive capability", () => {
    const legacy = { status: "server_info", serverId: "host", features: {} };
    expect(
      ServerInfoStatusPayloadSchema.parse(legacy).features?.agentWorkspaceFilter,
    ).toBeUndefined();
    expect(
      ServerInfoStatusPayloadSchema.parse({ ...legacy, features: { agentWorkspaceFilter: true } })
        .features?.agentWorkspaceFilter,
    ).toBe(true);
    for (const features of [undefined, {}, { agentWorkspaceFilter: true }]) {
      const message = {
        type: "session",
        message: { type: "status", payload: { ...legacy, features } },
      };
      expect(validateWSOutboundMessage(message).success).toBe(true);
    }
    expect(
      // The status envelope is intentionally open; typed payload parsing is separate.
      ServerInfoStatusPayloadSchema.safeParse({
        ...legacy,
        features: { agentWorkspaceFilter: "true" },
      }).success,
    ).toBe(false);
  });
});
