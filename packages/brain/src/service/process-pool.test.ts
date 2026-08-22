import { describe, expect, it } from "vitest";

import type { Profile } from "../config/schema.js";
import type { Model } from "../types.js";
import { ModelProcessPool } from "./process-pool.js";
import { Scheduler } from "./scheduler.js";
import type { Supervisor } from "./supervisor.js";

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

function createPool(maxModels: number) {
  const supervisors: FakeSupervisor[] = [];
  const makeSupervisor = (index: number): Supervisor => {
    const supervisor = new FakeSupervisor(index);
    supervisors.push(supervisor);
    return supervisor as unknown as Supervisor;
  };
  const pool = new ModelProcessPool({
    initialSupervisor: makeSupervisor(0),
    maxModels,
    createSupervisor: makeSupervisor,
    createScheduler: (supervisor, loadModel, onChange) =>
      new Scheduler<Supervisor>({ supervisor, loadModel, onChange }),
    loadModel: async (supervisor, target) => {
      const fake = supervisor as unknown as FakeSupervisor;
      fake.state = "starting";
      fake.model = target;
      fake.profile = { parallelSlots: 1 } as Profile;
      fake.state = "ready";
      return 1;
    },
  });
  return { pool, supervisors };
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
    const { pool } = createPool(2);
    const releaseA = deferred();
    const releaseB = deferred();
    const residents: Supervisor[] = [];

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
});
