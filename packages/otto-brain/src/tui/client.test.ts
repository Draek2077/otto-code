import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshot } from "../../test-tui.js";
import { BrainStatusStore, type BrainStatusSource } from "../client/status-store.js";
import { BrainTuiClient, type BrainTuiClientPorts } from "./client.js";
import { BrainTuiLiveSchema, type BrainTuiLive } from "./live.js";
import { BrainTuiExecutionSchema } from "./actions.js";
import { ProfileDraft } from "./draft.js";
const clients: BrainTuiClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  vi.useRealTimers();
});
function fixture(writable = true) {
  let receive: Parameters<BrainStatusSource<BrainTuiLive>["open"]>[0] | undefined;
  const signals: AbortSignal[] = [];
  const source: BrainStatusSource<BrainTuiLive> = {
    open: (next, signal) => {
      receive = next;
      signals.push(signal);
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
        if (signal.aborted) resolve();
      });
    },
  };
  const initial = snapshot();
  if (!writable) initial.availableActions = ["refresh", "hf.search", "hf.quants"];
  const ports: BrainTuiClientPorts = {
    status: new BrainStatusStore(source, { streamId: "fixture-terminal" }),
    endpoint: "https://selected-owner.invalid:1234",
    readSnapshot: vi.fn(async () => ({
      ...snapshot(),
      availableActions: initial.availableActions,
    })),
    readResources: vi.fn(async () => ({
      cpu: 0.25,
      cpuCount: 2,
      ramUsedBytes: 1,
      ramTotalBytes: 2,
      gpu: null,
    })),
    readJobs: vi.fn(async () => []),
    execute: vi.fn<BrainTuiClientPorts["execute"]>().mockResolvedValue({ kind: "accepted" }),
  };
  const client = new BrainTuiClient(initial, ports);
  clients.push(client);
  const emit = (patch: Partial<BrainTuiLive> = {}) =>
    receive?.status(
      BrainTuiLiveSchema.parse({
        instanceId: initial.instanceId,
        version: "fixture",
        state: "stopped",
        libraryRevision: 0,
        jobRevision: 0,
        capabilities: { writable: true, tui: true },
        residents: [],
        telemetry: initial.telemetry,
        ...patch,
      }),
    );
  return { initial, ports, client, emit, signals };
}
function saved(revision: string, temperature: number) {
  const initial = snapshot();
  return BrainTuiExecutionSchema.parse({
    kind: "profile",
    modelId: initial.models[0].model.id,
    saved: {
      revision,
      profile: { ...initial.models[0].profile, temperature },
      fields: initial.models[0].fields,
      warnings: [],
      calibration: { state: "theoretical", kvBytesPerToken: null },
      budget: null,
      maxContextThatFits: null,
    },
  });
}
describe("demand-owned terminal client", () => {
  it("is passive, shares one stream and probes hardware only while retained", async () => {
    const f = fixture();
    expect(f.signals).toHaveLength(0);
    expect(f.ports.readResources).not.toHaveBeenCalled();
    const releaseOne = f.client.retainStatus();
    const releaseTwo = f.client.retainStatus();
    await Promise.resolve();
    f.emit();
    expect(f.signals).toHaveLength(1);
    await vi.waitFor(() => expect(f.ports.readResources).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    expect(f.ports.readResources).toHaveBeenCalledTimes(1);
    releaseOne();
    expect(f.signals[0].aborted).toBe(false);
    releaseTwo();
    expect(f.signals[0].aborted).toBe(true);
    expect(vi.mocked(f.ports.readResources).mock.calls[0][0].aborted).toBe(true);
    await Promise.resolve();
    expect(f.ports.readResources).toHaveBeenCalledTimes(1);
    expect(f.ports.execute).not.toHaveBeenCalled();
  });
  it("publishes its exact normalized acknowledgment before the draft serializes a newer edit", async () => {
    const f = fixture();
    let accept!: (value: ReturnType<typeof saved>) => void;
    vi.mocked(f.ports.execute)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            accept = resolve;
          }),
      )
      .mockResolvedValueOnce(saved("revision-3", 0.9));
    const row = f.initial.models[0];
    const draft = new ProfileDraft(row);
    draft.write("temperature", 0.85);
    const saving = draft.save(f.client, row.model.id, new AbortController().signal);
    draft.write("temperature", 0.9);
    accept(saved("revision-2", 0.8));
    await saving;
    expect(vi.mocked(f.ports.execute).mock.calls.map(([action]) => action)).toEqual([
      {
        type: "profile.save",
        modelId: row.model.id,
        patch: { temperature: 0.85 },
        expectedRevision: "revision-1",
      },
      {
        type: "profile.save",
        modelId: row.model.id,
        patch: { temperature: 0.9 },
        expectedRevision: "revision-2",
      },
    ]);
    expect(draft.revision).toBe("revision-3");
    expect(draft.profile.temperature).toBe(0.9);
  });
  it("keeps an admitted job in the snapshot and closes only client demand", async () => {
    const f = fixture();
    vi.mocked(f.ports.execute).mockResolvedValue({
      kind: "job",
      job: {
        id: "durable-job",
        operation: "bench",
        modelId: f.initial.models[0].model.id,
        state: "queued",
        progress: [],
        fraction: null,
        error: null,
        cancelable: true,
      },
    });
    expect(
      await f.client.execute({
        type: "job.start",
        operation: "bench",
        modelId: f.initial.models[0].model.id,
      }),
    ).toEqual({ status: "success", value: { jobId: "durable-job" } });
    expect(f.client.getSnapshot().jobs[0].id).toBe("durable-job");
    await f.client.close();
    expect(f.ports.execute).toHaveBeenCalledTimes(1);
  });
  it("invalidates a late accepted write after a host lifetime change", async () => {
    const f = fixture();
    let accept!: (value: ReturnType<typeof saved>) => void;
    vi.mocked(f.ports.execute).mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    );
    f.client.retainStatus();
    await Promise.resolve();
    f.emit();
    const pending = f.client.execute({
      type: "profile.save",
      modelId: f.initial.models[0].model.id,
      patch: { temperature: 0.9 },
      expectedRevision: "revision-1",
    });
    vi.mocked(f.ports.readSnapshot).mockResolvedValue({ ...snapshot(), instanceId: "new-owner" });
    f.emit({ instanceId: "new-owner" });
    accept(saved("old-ack", 0.9));
    expect(await pending).toMatchObject({ status: "conflict" });
    expect(f.client.getSnapshot().models.some((row) => row.revision === "old-ack")).toBe(false);
  });
  it("keeps request-specific read-only permissions across live status and explicit refresh", async () => {
    const f = fixture(false);
    f.client.retainStatus();
    await Promise.resolve();
    f.emit({ capabilities: { writable: true, tui: true } });
    expect(f.client.getSnapshot().availableActions).toEqual(["refresh", "hf.search", "hf.quants"]);
    expect(
      await f.client.execute({ type: "model.load", modelId: f.initial.models[0].model.id }),
    ).toMatchObject({ status: "unsupported" });
    expect(f.ports.execute).not.toHaveBeenCalled();
    expect(await f.client.execute({ type: "refresh" })).toMatchObject({ status: "success" });
    expect(f.ports.readSnapshot).toHaveBeenCalledOnce();
    expect(f.client.getSnapshot().availableActions).not.toContain("profile.save");
  });
  it("does not restore a pre-save profile from a delayed library refresh", async () => {
    const f = fixture();
    let stale!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(f.ports.readSnapshot)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            stale = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...snapshot(),
        libraryRevision: 1,
        models: [{ ...f.initial.models[0], revision: "revision-2" }],
      });
    f.client.retainStatus();
    await Promise.resolve();
    f.emit({ libraryRevision: 1 });
    vi.mocked(f.ports.execute).mockResolvedValue(saved("revision-2", 0.8));
    expect(
      await f.client.execute({
        type: "profile.save",
        modelId: f.initial.models[0].model.id,
        patch: { temperature: 0.8 },
        expectedRevision: "revision-1",
      }),
    ).toMatchObject({ status: "success" });
    const revisions: string[] = [];
    const release = f.client.subscribe(() => {
      const row = f.client.getSnapshot().models[0];
      if (row) revisions.push(row.revision);
    });
    stale(snapshot());
    await vi.waitFor(() => expect(f.ports.readSnapshot).toHaveBeenCalledTimes(2));
    expect(revisions).not.toContain("revision-1");
    release();
  });
});
