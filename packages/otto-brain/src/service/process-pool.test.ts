import { describe, expect, it } from "vitest";

import { ProfileSchema, type Profile } from "../config/schema.js";
import type { Model } from "../types.js";
import { ModelProcessPool } from "./process-pool.js";
import { Scheduler } from "./scheduler.js";

function model(id: string): Model {
  return {
    id,
    displayName: id.toUpperCase(),
    modelPath: `${id}.gguf`,
    mmprojPath: null,
    mmprojBytes: 0,
    quant: "Q4_K_M",
    sizeBytes: 1,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: null,
  };
}

class FakeSupervisor {
  state = "stopped";
  model: Model | null = null;
  profile: Profile | null = null;
  stopCount = 0;
  readonly host = "127.0.0.1";
  readonly internalPort: number;

  constructor(index: number) {
    this.internalPort = 20800 + index;
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
    this.state = "stopped";
    this.model = null;
    this.profile = null;
  }
}

function createPool(
  maxModels: number,
  parallelSlots = 1,
  beforeLoad?: (reserved: number, signal: AbortSignal) => Promise<void>,
) {
  const supervisors: FakeSupervisor[] = [];
  const loads: { supervisor: FakeSupervisor; model: Model; profile: Profile | undefined }[] = [];
  const makeSupervisor = (index: number): FakeSupervisor => {
    const supervisor = new FakeSupervisor(index);
    supervisors.push(supervisor);
    return supervisor;
  };
  const pool = new ModelProcessPool({
    initialSupervisor: makeSupervisor(0),
    maxModels,
    createSupervisor: makeSupervisor,
    createScheduler: (supervisor, loadModel, onChange) =>
      new Scheduler<FakeSupervisor>({ supervisor, loadModel, onChange }),
    loadModel: async (supervisor, target, _reservedElsewhereBytes, profile, signal) => {
      await beforeLoad?.(_reservedElsewhereBytes, signal);
      const fake = supervisor;
      loads.push({ supervisor: fake, model: target, profile });
      fake.state = "starting";
      fake.model = target;
      fake.profile = profile ?? ProfileSchema.parse({ contextSize: 2048, parallelSlots });
      fake.state = "ready";
      return 1;
    },
  });
  return { pool, supervisors, loads };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition was not reached");
}

describe("ModelProcessPool", () => {
  it("serves different models concurrently in independent processes", async () => {
    const { pool } = createPool(2, 2);
    const releaseA = deferred();
    const releaseB = deferred();
    const residents: FakeSupervisor[] = [];

    const a = pool.submit(model("a"), async (supervisor) => {
      residents.push(supervisor);
      await releaseA.promise;
    });
    const b = pool.submit(model("b"), async (supervisor) => {
      residents.push(supervisor);
      await releaseB.promise;
    });

    await waitFor(() => residents.length === 2);
    expect(residents[0]).not.toBe(residents[1]);
    expect(pool.residentSupervisors()).toHaveLength(2);
    releaseA.resolve();
    releaseB.resolve();
    await Promise.all([a, b]);
  });

  it("evicts the least-recently-used idle model when the limit is full", async () => {
    const { pool, supervisors } = createPool(2);
    await pool.preload(model("a"));
    await pool.preload(model("b"));

    await pool.preload(model("c"));

    expect(pool.supervisorFor("a")).toBeNull();
    expect(pool.supervisorFor("b")).not.toBeNull();
    expect(pool.supervisorFor("c")).not.toBeNull();
    expect(supervisors[0].stopCount).toBe(1);
  });

  it("waits instead of evicting a process that is still serving a request", async () => {
    const { pool, supervisors } = createPool(1);
    const release = deferred();
    let bStarted = false;
    const a = pool.submit(model("a"), async () => release.promise);
    await waitFor(() => pool.supervisorFor("a")?.state === "ready");

    const b = pool.submit(model("b"), async () => {
      bStarted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(bStarted).toBe(false);
    expect(supervisors[0].stopCount).toBe(0);

    release.resolve();
    await a;
    await b;
    expect(bStarted).toBe(true);
    expect(supervisors[0].stopCount).toBe(1);
  });

  it("keeps serving resident models while an unloaded model waits for eviction", async () => {
    const { pool } = createPool(2, 2);
    const releaseA = deferred();
    const releaseB = deferred();
    const a = pool.submit(model("a"), async () => releaseA.promise);
    const b = pool.submit(model("b"), async () => releaseB.promise);
    await waitFor(
      () =>
        pool.supervisorFor("a")?.state === "ready" && pool.supervisorFor("b")?.state === "ready",
    );

    let cStarted = false;
    const c = pool.submit(model("c"), async () => {
      cStarted = true;
    });
    let residentRequestFinished = false;
    const residentRequest = pool.submit(model("a"), async () => {
      residentRequestFinished = true;
    });

    await waitFor(() => residentRequestFinished);
    expect(cStarted).toBe(false);

    releaseB.resolve();
    await b;
    await c;
    expect(cStarted).toBe(true);
    releaseA.resolve();
    await a;
    await residentRequest;
  });

  it("swaps before a managed operation when only one model is allowed", async () => {
    const { pool, loads } = createPool(1);
    await pool.preload(model("a"));
    const operationProfile = ProfileSchema.parse({ contextSize: 8192, parallelSlots: 1 });

    await pool.submitOperation(
      model("b"),
      async (process) => {
        expect(pool.supervisorFor("a")).toBeNull();
        await process.start(operationProfile);
        expect(process.supervisor.model?.id).toBe("b");
        expect(process.supervisor.state).toBe("ready");
        await process.stop();
      },
      { kind: "calibrate" },
    );

    expect(loads.some((load) => load.model.id === "b" && load.profile === operationProfile)).toBe(
      true,
    );
    expect(pool.residentSupervisors()).toHaveLength(0);
  });

  it("keeps the first resident while a managed operation uses a second allowed process", async () => {
    const { pool } = createPool(2);
    await pool.preload(model("a"));

    await pool.submitOperation(
      model("b"),
      async (process) => {
        await process.start(ProfileSchema.parse({ contextSize: 8192, parallelSlots: 1 }));
        expect(pool.supervisorFor("a")?.state).toBe("ready");
        expect(pool.supervisorFor("b")?.state).toBe("ready");
        expect(pool.residentSupervisors()).toHaveLength(2);
        await process.stop();
      },
      { kind: "sweep" },
    );

    expect(pool.supervisorFor("a")?.state).toBe("ready");
  });
});

it("settles an aborted queued model without waiting for a busy resident", async () => {
  const { pool, loads } = createPool(1);
  const release = deferred();
  const active = pool.submit(model("a"), () => release.promise);
  await waitFor(() => pool.supervisorFor("a")?.state === "ready");
  const controller = new AbortController();
  const queued = pool.submit(model("b"), async () => {}, { signal: controller.signal });
  const rejected = expect(queued).rejects.toThrow("cancelled");
  controller.abort(new Error("cancelled"));
  await rejected;
  expect(pool.stats().queued).toBe(0);
  expect(loads.map((load) => load.model.id)).toEqual(["a"]);
  release.resolve();
  await active;
  await pool.stop();
});

it("serializes loads so the second process sees the first reservation", async () => {
  const firstLoad = deferred();
  const reservations: number[] = [];
  const { pool } = createPool(2, 1, async (reserved) => {
    reservations.push(reserved);
    if (reservations.length === 1) await firstLoad.promise;
  });
  const a = pool.preload(model("a"));
  const b = pool.preload(model("b"));
  await waitFor(() => reservations.length === 1);
  expect(reservations).toEqual([0]);
  firstLoad.resolve();
  await Promise.all([a, b]);
  expect(reservations).toEqual([0, 1]);
  await pool.stop();
});

it("shutdown settles both pool and per-model queues and prevents subsequent admission", async () => {
  const { pool } = createPool(1);
  const release = deferred();
  const active = pool.submit(model("a"), () => release.promise);
  await waitFor(() => pool.supervisorFor("a")?.state === "ready");
  const same = pool.submit(model("a"), async () => {
    throw new Error("must not run");
  });
  const other = pool.submit(model("b"), async () => {
    throw new Error("must not run");
  });
  const sameRejected = expect(same).rejects.toThrow("stopped");
  const otherRejected = expect(other).rejects.toThrow("stopped");
  await waitFor(() => pool.stats().queued === 2);
  await pool.stop();
  await Promise.all([sameRejected, otherRejected]);
  await expect(pool.preload(model("c"))).rejects.toThrow("stopped");
  release.resolve();
  await active;
  expect(pool.residentSupervisors()).toEqual([]);
});

it("shutdown during a load reaps the late child and cannot publish it resident", async () => {
  const release = deferred();
  const { pool, supervisors } = createPool(2, 1, () => release.promise);
  const a = pool.preload(model("a"));
  const rejected = expect(a).rejects.toThrow("stopped");
  await waitFor(() => pool.supervisorFor("a") !== null);
  const stopping = pool.stop();
  release.resolve();
  await Promise.all([rejected, stopping]);
  expect(pool.residentSupervisors()).toEqual([]);
  expect(supervisors.every((supervisor) => supervisor.state === "stopped")).toBe(true);
});

it("runs two real fixture children, protects a busy model and reaps the evicted child", async () => {
  const { createSupervisorFixture } = await import("../../test-runtime.js");
  const fs = await import("node:fs");
  const first = await createSupervisorFixture();
  const second = await createSupervisorFixture();
  const children = [first, second];
  const a = { ...first.model, id: "a", displayName: "A" };
  const b = { ...second.model, id: "b", displayName: "B" };
  const c = { ...first.model, id: "c", displayName: "C" };
  const pool = new ModelProcessPool({
    maxModels: 2,
    initialSupervisor: first.supervisor,
    createSupervisor: (index) => children[index].supervisor,
    createScheduler: (supervisor, loadModel, onChange) =>
      new Scheduler({ supervisor, loadModel, onChange }),
    loadModel: async (supervisor, target) => {
      await supervisor.stop();
      await supervisor.start(target, first.profile);
      return target.sizeBytes;
    },
  });
  const release = deferred();
  let active: Promise<unknown> | null = null;
  try {
    await Promise.all([pool.preload(a), pool.preload(b)]);
    const firstPid = first.supervisor.status().pid;
    const secondPid = second.supervisor.status().pid;
    expect(firstPid).toBeTypeOf("number");
    expect(secondPid).toBeTypeOf("number");
    expect(firstPid).not.toBe(secondPid);
    const properties = await pool.submit(b, (supervisor) => supervisor.properties());
    expect(properties).toHaveProperty("args");
    active = pool.submit(b, () => release.promise);
    await waitFor(() => pool.stats().queued === 0);
    await expect(pool.unload("b")).rejects.toThrow("serving requests");
    await pool.preload(c);
    expect(pool.supervisorFor("a")).toBeNull();
    expect(first.supervisor.status().pid).not.toBe(firstPid);
    expect(second.supervisor.status().pid).toBe(secondPid);
    expect(() => process.kill(Number(firstPid), 0)).toThrow();
    expect(pool.reservationFor("c")).toBe(c.sizeBytes);
  } finally {
    release.resolve();
    await active;
    await pool.stop();
    for (const child of children) {
      expect(child.supervisor.state).toBe("stopped");
      fs.rmSync(child.root, { recursive: true, force: true });
    }
  }
});

it("serializes overlapping reductions of the process limit", async () => {
  const { pool } = createPool(3);
  await Promise.all([pool.preload(model("a")), pool.preload(model("b")), pool.preload(model("c"))]);
  await Promise.all([pool.configure(1), pool.configure(1), pool.configure(1)]);
  expect(pool.supervisors()).toHaveLength(1);
  await pool.preload(model("d"));
  expect(pool.residentSupervisors()).toHaveLength(1);
  await pool.stop();
});

it("passes lifetime cancellation to an in-flight loader before shutdown waits for it", async () => {
  let entered = false;
  let aborted = false;
  const { pool } = createPool(1, 1, async (_reserved, signal) => {
    entered = true;
    await new Promise<void>((_resolve, reject) =>
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(signal.reason);
        },
        { once: true },
      ),
    );
  });
  const loading = pool.preload(model("a"));
  const rejected = expect(loading).rejects.toThrow("stopped");
  await waitFor(() => entered);
  await pool.stop();
  await rejected;
  expect(aborted).toBe(true);
});
