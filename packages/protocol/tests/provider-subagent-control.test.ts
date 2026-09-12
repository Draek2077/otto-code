import { describe, expect, it } from "vitest";
import {
  SessionInboundMessageSchema,
  ProviderSubagentDescriptorPayloadSchema,
} from "../src/messages.js";
import { validateWSOutboundMessage } from "../src/validation/ws-outbound.js";

const validateSessionMessage = (message: unknown) =>
  validateWSOutboundMessage({ type: "session", message });

describe("provider subagent control wire contract", () => {
  it("accepts explicit control requests without granting a wider stop by default", () => {
    const request = SessionInboundMessageSchema.parse({
      type: "agent.provider_subagents.control.request",
      requestId: "request",
      parentAgentId: "parent",
      subagentId: "child",
      action: "stop",
    });
    expect(request).not.toHaveProperty("allowStopParent");
    expect(SessionInboundMessageSchema.safeParse({ ...request, action: "delete" }).success).toBe(
      false,
    );
  });
  it("accepts old descriptors and validates the new lifecycle metadata", () => {
    const old = {
      id: "child",
      parentAgentId: "parent",
      provider: "codex",
      title: "Noop",
      description: null,
      status: "canceled",
      createdAt: "2026-09-12T10:00:00Z",
      updatedAt: "2026-09-12T10:00:01Z",
      toolCallId: null,
    };
    expect(ProviderSubagentDescriptorPayloadSchema.safeParse(old).success).toBe(true);
    const update = {
      type: "agent.provider_subagents.update",
      payload: {
        kind: "upsert",
        subagent: { ...old, archivedAt: "2026-09-12T10:01:00Z", stopScope: "child" },
      },
    };
    expect(validateSessionMessage(update).success).toBe(true);
    expect(
      validateSessionMessage({
        ...update,
        payload: {
          ...update.payload,
          subagent: { ...update.payload.subagent, stopScope: "unrestricted" },
        },
      }).success,
    ).toBe(false);
  });
  it("validates success and failure control responses in the generated validator", () => {
    for (const error of [null, "provider rejected cancellation"]) {
      expect(
        validateSessionMessage({
          type: "agent.provider_subagents.control.response",
          payload: { requestId: "request", parentAgentId: "parent", subagentId: "child", error },
        }).success,
      ).toBe(true);
    }
  });
});
