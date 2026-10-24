import { expect, test } from "vitest";
import { BrainStatusSchema } from "@getpaseo/protocol/otto/brain";
import type { BrainConnectionStateSnapshot } from "./connection-state";
import { statusToView, screenAccess, sidebarPresentation } from "./status-mapping";
import { deriveBrainActivity, deriveBrainState } from "../state";

test("sidebar bootstrap never inserts a provisional disabled-host row but keeps enabled host failure visible", () => {
  const initial = {
    serverId: "host",
    enabled: undefined,
    connection: "connecting" as const,
    status: null,
  };
  expect(sidebarPresentation(initial)).toMatchObject({ visible: false });
  expect(sidebarPresentation({ ...initial, enabled: false })).toMatchObject({ visible: false });
  expect(
    sidebarPresentation({ ...initial, enabled: true, connection: "disconnected" }),
  ).toMatchObject({ visible: true, state: "unreachable", label: "Brain - unreachable" });
});

function fixture(): BrainConnectionStateSnapshot {
  const capabilities = Object.fromEntries(
    Object.keys(BrainStatusSchema.shape.capabilities.shape).map((key) => [
      key,
      key === "apiVersion" ? 3 : true,
    ]),
  );
  const status = BrainStatusSchema.parse({
    instanceId: "host",
    running: true,
    reachable: true,
    state: "ready",
    version: "fixture",
    model: "First",
    modelId: "a",
    queued: 0,
    jobRevision: 0,
    libraryRevision: 0,
    ownerSettingsRevision: "owner-revision",
    telemetry: { requests: 0, ok: 0, reasoningOnly: 0, truncated: 0, warning: null },
    jobs: [],
    capabilities,
    scheduler: { waitingModelIds: {} },
    residents: ["a", "b"].map((id) => ({
      residentId: `resident-${id}`,
      modelId: id,
      model: id,
      state: "ready",
      loadSeconds: 1,
      vramBytes: 100,
      startedAt: "start",
      reasoning: id === "a",
      slots: {
        total: 1,
        busy: 1,
        idle: 0,
        prefill: 0,
        decode: 1,
        threads: [
          {
            slot: 0,
            phase: "decode",
            promptTokens: 1,
            generatedTokens: 2,
            promptTokensPerSecond: 3,
            tokensPerSecond: 4,
          },
        ],
      },
      inference: {
        activeRequests: 1,
        processing: 0,
        thinking: id === "a" ? 1 : 0,
        generating: id === "b" ? 1 : 0,
        slotStages: { "0": id === "a" ? "thinking" : "generating" },
      },
    })),
  });
  return {
    connection: {
      version: 1,
      revision: "revision",
      config: {
        enabled: true,
        autoStart: false,
        mode: "local",
        remote: { host: "", port: 1234, secure: false, certFingerprint: null },
      },
      credential: { stored: false, effectiveSource: "none" },
    },
    owner: null,
    ownerError: null,
    feed: {
      status,
      connection: "connected",
      cursor: "cursor",
      controlRevision: "revision",
      logs: [],
      firstLogIndex: 0,
      nextLogIndex: 0,
      error: null,
    },
    localRunning: true,
    endpoint: "http://actual:1234",
    loading: false,
    connected: true,
    error: null,
  };
}
test("dual brains retain resident-qualified slot identity and distinct actual proxy stages", () => {
  const status = statusToView(fixture(), null);
  expect(status.slots?.threads).toMatchObject([
    { modelId: "a", residentId: "resident-a", slot: 0, stage: "thinking" },
    { modelId: "b", residentId: "resident-b", slot: 0, stage: "generating" },
  ]);
  expect(deriveBrainActivity(status)).toMatchObject({
    kind: "split",
    slots: ["thinking", "generating"],
  });
});
test("an unloaded reachable Brain host is idle rather than being reported off", () => {
  const state = fixture();
  if (!state.feed?.status) throw new Error("Fixture status missing");
  state.feed.status = {
    ...state.feed.status,
    state: "stopped",
    model: null,
    modelId: null,
    residents: [],
  };
  expect(deriveBrainState(statusToView(state, null))).toBe("idle");
});
test("disconnect invalidates old resident activity and remote write permission", () => {
  const state = fixture();
  if (!state.feed || !state.connection) throw new Error("Fixture connection missing");
  state.connection.config.mode = "remote";
  state.feed.connection = "disconnected";
  const status = statusToView(state, null);
  expect(status).toMatchObject({
    running: false,
    reachable: false,
    residents: [],
    slots: { threads: [] },
    capabilities: { writable: false },
    activity: { kind: null },
  });
  expect(deriveBrainState(status)).toBe("unreachable");
});
test("read-only Remote Brain keeps its management readouts without gaining write permission", () => {
  const state = fixture();
  if (!state.connection || !state.feed?.status) throw new Error("Fixture status missing");
  state.connection.config.mode = "remote";
  state.feed.status.capabilities.writable = false;
  expect(screenAccess(state)).toMatchObject({ manage: true, hfSearch: true });
  expect(statusToView(state, null).capabilities.writable).toBe(false);
});
