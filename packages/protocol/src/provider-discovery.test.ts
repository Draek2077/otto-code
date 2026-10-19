import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateWSOutboundMessage } from "./validation/ws-outbound.js";
import {
  ProviderDiagnosticRequestMessageSchema,
  ProviderDiagnosticResponseMessageSchema,
  ProviderDiscoveryOptionsSchema,
} from "./provider-discovery.js";

const id = "01a14152-e1ac-72f4-9565-0978e4520014";
describe("additive discovery diagnostic protocol", () => {
  it("round-trips the safe sidecar through source and generated outbound validation", () => {
    const envelope = {
      type: "session",
      message: {
        type: "provider_diagnostic_response",
        payload: {
          provider: "codex",
          diagnostic: "",
          requestId: "r",
          discovery: {
            runtime: {
              resolvedExecutable: "/codex",
              version: "0.162.1",
              reportedHome: null,
              launchHome: null,
              homeVerification: "unverified",
              configuredModelProvider: null,
              storageBackend: null,
            },
            target: { requestedId: id, readAttempted: true, status: "not_found" },
            listing: {
              status: "ok",
              rawCount: 0,
              cursorPresent: true,
              nextCursor: null,
              targetPresent: false,
              excluded: { invalidMetadata: 0, cwd: 0, metadataGeneration: 0, alreadyImported: 0 },
              eligibleCount: 0,
            },
            knownImportedSessionCount: 16,
            request: { threadId: id },
          },
        },
      },
    };
    expect(ProviderDiagnosticResponseMessageSchema.parse(envelope.message)).toEqual(
      envelope.message,
    );
    expect(validateWSOutboundMessage(envelope)).toEqual({ success: true, data: envelope });
    expect(
      ProviderDiscoveryOptionsSchema.parse({ threadId: id, includeTurns: true, archived: true }),
    ).toEqual({ threadId: id });
  });
  it("keeps existing request and response fields unchanged", () => {
    const request = { type: "provider_diagnostic_request", provider: "codex", requestId: "r" };
    const response = {
      type: "provider_diagnostic_response",
      payload: { provider: "codex", diagnostic: "existing text", requestId: "r" },
    };
    expect(ProviderDiagnosticRequestMessageSchema.parse(request)).toEqual(request);
    expect(ProviderDiagnosticResponseMessageSchema.parse(response)).toEqual(response);
    // An old structural client/daemon ignores the additive fields in either direction.
    const oldRequest = ProviderDiagnosticRequestMessageSchema.omit({ discovery: true });
    expect(oldRequest.parse({ ...request, discovery: { threadId: id } })).toEqual(request);
    const oldResponse = z.object({
      type: z.literal("provider_diagnostic_response"),
      payload: ProviderDiagnosticResponseMessageSchema.shape.payload.omit({ discovery: true }),
    });
    expect(
      oldResponse.parse({ ...response, payload: { ...response.payload, discovery: {} } }),
    ).toEqual(response);
  });
  it.each([
    { threadId: "../session" },
    { threadId: " " },
    { threadId: id, limit: 0 },
    { threadId: id, limit: 101 },
    { threadId: id, limit: 1.5 },
    { threadId: id, compareSource: "all" },
    { threadId: id, cursor: "" },
  ])("rejects invalid diagnostic inputs", (value) => {
    expect(ProviderDiscoveryOptionsSchema.safeParse(value).success).toBe(false);
  });
  it("accepts an exact v7 UUID and bounded source/cursor options", () => {
    expect(
      ProviderDiscoveryOptionsSchema.parse({
        threadId: id,
        limit: 100,
        cursor: "opaque",
        compareSource: "appServer",
      }),
    ).toEqual({ threadId: id, limit: 100, cursor: "opaque", compareSource: "appServer" });
  });
});
