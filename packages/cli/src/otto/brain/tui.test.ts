import { describe, expect, it, vi } from "vitest";
import { BrainStatusSchema } from "@getpaseo/protocol/otto/brain";
import { openDaemonBrainTui, type BrainTuiDaemonClient } from "./tui.js";
function fixture(mode: "local" | "remote" = "local", enabled = true) {
  let running = false;
  const calls: Array<{ method: string; input: unknown }> = [];
  const telemetry = { requests: 0, ok: 0, reasoningOnly: 0, truncated: 0, warning: null };
  const connection = {
    version: 1,
    revision: "selected-connection-revision",
    config: {
      enabled,
      autoStart: true,
      mode,
      remote: { host: "remote.example", port: 1234, secure: true, certFingerprint: null },
    },
    credential: { stored: false, effectiveSource: "none" },
  };
  const capabilities = Object.fromEntries(
    Object.keys(BrainStatusSchema.shape.capabilities.shape).map((key) => [
      key,
      key === "apiVersion" ? 3 : true,
    ]),
  );
  const status = {
    instanceId: "actual-owner",
    running: true,
    reachable: true,
    state: "stopped",
    version: "fixture",
    model: null,
    modelId: null,
    queued: 0,
    libraryRevision: 0,
    jobRevision: 0,
    ownerSettingsRevision: null,
    telemetry,
    jobs: [],
    capabilities,
    residents: [],
    scheduler: { waitingModelIds: {} },
  };
  const snapshot = {
    instanceId: "actual-owner",
    libraryRevision: 0,
    jobRevision: 0,
    version: "fixture",
    state: "stopped",
    connection: "connected",
    endpoint: null,
    message: null,
    runtime: null,
    gpu: null,
    system: null,
    models: [],
    residents: [],
    logs: [],
    jobs: [],
    catalog: [],
    runtimes: [],
    storage: null,
    telemetry,
    rankings: [],
    benchmarks: [],
    availableActions: ["refresh"],
  };
  const invoke = vi.fn(
    async (_pluginId: string, method: string, input: unknown): Promise<unknown> => {
      calls.push({ method, input });
      if (method === "brain.bootstrap")
        return {
          ok: true,
          value: {
            connection,
            owner: null,
            ownerError: null,
            localRunning: running,
            endpoint: running || mode === "remote" ? "https://actual-owner:1234" : null,
          },
        };
      if (method === "brain.tui.start") {
        running = true;
        return { ok: true, value: { accepted: true } };
      }
      if (method === "brain.query") return { ok: true, value: status };
      if (method === "brain.tui.read") return { ok: true, value: snapshot };
      throw new Error("Unexpected fixture request");
    },
  );
  const client: BrainTuiDaemonClient = {
    getLastServerInfoMessage: () => ({ features: { ottoBrain: true, ottoBrainTui: true } }),
    invokePluginRpc: invoke,
  };
  return { client, calls, invoke };
}
describe("Otto CLI terminal composition", () => {
  it("starts only an unloaded local management owner and uses its actual endpoint and revision", async () => {
    const f = fixture();
    const viewer = await openDaemonBrainTui(f.client);
    try {
      expect(f.calls.map((call) => call.method)).toEqual([
        "brain.bootstrap",
        "brain.tui.start",
        "brain.bootstrap",
        "brain.query",
        "brain.tui.read",
      ]);
      expect(f.calls[1].input).toEqual({ connectionRevision: "selected-connection-revision" });
      expect(viewer.getSnapshot().endpoint).toBe("https://actual-owner:1234");
      expect(f.calls[4].input).toMatchObject({
        connectionRevision: "selected-connection-revision",
        resource: "snapshot",
      });
      expect(
        f.calls.some((call) => call.method === "brain.lifecycle" || call.method === "brain.action"),
      ).toBe(false);
    } finally {
      await viewer.close();
    }
  });
  it("reads the selected Remote owner without starting a local or Remote service", async () => {
    const f = fixture("remote");
    const viewer = await openDaemonBrainTui(f.client);
    try {
      expect(f.calls.map((call) => call.method)).toEqual([
        "brain.bootstrap",
        "brain.query",
        "brain.tui.read",
      ]);
    } finally {
      await viewer.close();
    }
  });
  it("does not override disabled intent even when autostart was saved", async () => {
    const f = fixture("local", false);
    await expect(openDaemonBrainTui(f.client)).rejects.toThrow("Enable Brain");
    expect(f.calls.map((call) => call.method)).toEqual(["brain.bootstrap"]);
  });
  it("requires the terminal capability before reading settings or admitting operations", async () => {
    const f = fixture();
    f.client.getLastServerInfoMessage = () => ({ features: { ottoBrain: true } });
    await expect(openDaemonBrainTui(f.client)).rejects.toMatchObject({
      code: "DAEMON_UPDATE_REQUIRED",
    });
    expect(f.invoke).not.toHaveBeenCalled();
  });
});
