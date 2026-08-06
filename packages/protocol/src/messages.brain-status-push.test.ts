import { describe, expect, test } from "vitest";

import {
  BrainCapabilitiesSchema,
  BrainHostStatusSchema,
  KnownStatusPayloadSchema,
  ServerInfoStatusPayloadSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

/**
 * The brain publishes its own state, the daemon fans it out as a `status`
 * broadcast, and both sides version independently. These pin the parts of that
 * contract a change could quietly break.
 */
describe("brain_status_changed", () => {
  const snapshot = {
    running: true,
    reachable: true,
    state: "starting",
    model: "some-model",
    apiVersion: 1,
    capabilities: { load: true, events: true },
  };

  test("parses as a session status broadcast", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "status",
      payload: { status: "brain_status_changed", brain: snapshot },
    });
    expect(parsed).toMatchObject({
      type: "status",
      payload: { status: "brain_status_changed", brain: { state: "starting" } },
    });
  });

  test("is a known status payload, so the client can discriminate on it", () => {
    const parsed = KnownStatusPayloadSchema.parse({
      status: "brain_status_changed",
      brain: snapshot,
    });
    expect(parsed.status).toBe("brain_status_changed");
  });

  test("keeps fields this client has never heard of", () => {
    // The brain may grow a status field without a daemon or client upgrade; a
    // snapshot is complete by contract, so dropping the unknown half would make
    // the pushed answer strictly worse than the polled one.
    const parsed = KnownStatusPayloadSchema.parse({
      status: "brain_status_changed",
      brain: { ...snapshot, someFutureField: { depth: 2 } },
      someFutureEnvelopeField: true,
    });
    expect(parsed).toMatchObject({
      brain: { someFutureField: { depth: 2 } },
      someFutureEnvelopeField: true,
    });
  });

  test("an older daemon's status, with no brain fields at all, still parses", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "status",
      payload: { status: "some_future_status", detail: "hello" },
    });
    expect(parsed.type).toBe("status");
  });
});

describe("the brain event capability", () => {
  test("defaults to false, so a brain that predates the stream is not assumed to serve it", () => {
    expect(BrainCapabilitiesSchema.parse({}).events).toBe(false);
    expect(BrainHostStatusSchema.parse({ running: true }).apiVersion).toBeUndefined();
  });

  test("a brain that advertises it reports it", () => {
    const status = BrainHostStatusSchema.parse({
      running: true,
      apiVersion: 1,
      capabilities: { events: true },
    });
    expect(status.capabilities?.events).toBe(true);
    expect(status.apiVersion).toBe(1);
  });

  test("parses additive host API v2 inference stages and per-slot metrics", () => {
    const status = BrainHostStatusSchema.parse({
      running: true,
      apiVersion: 2,
      capabilities: { events: true, liveInference: true },
      inference: { activeRequests: 2, processing: 0, thinking: 1, generating: 1 },
      slots: {
        total: 2,
        busy: 2,
        threads: [{ slot: 0, phase: "decode", generatedTokens: 24, tokensPerSecond: 48 }],
      },
    });
    expect(status.capabilities?.liveInference).toBe(true);
    expect(status.inference?.thinking).toBe(1);
    expect(status.slots?.threads?.[0]?.tokensPerSecond).toBe(48);
  });

  test("unknown capability names survive, so a brain can grow one without a daemon bump", () => {
    const capabilities = BrainCapabilitiesSchema.parse({ events: true, somethingNewer: true });
    expect(capabilities).toMatchObject({ events: true, somethingNewer: true });
  });
});

describe("server_info.features.brainStatusPush", () => {
  test("is optional, so an older daemon that never sends it still parses", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "host-1",
      features: { brainConsole: true },
    });
    expect(parsed.features?.brainStatusPush).toBeUndefined();
  });

  test("carries the daemon's answer when present", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "host-1",
      features: { brainStatusPush: true },
    });
    expect(parsed.features?.brainStatusPush).toBe(true);
  });
});
