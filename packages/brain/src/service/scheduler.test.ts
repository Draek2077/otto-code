import { test } from "vitest";
import assert from "node:assert/strict";

import { Scheduler, type SchedulerSupervisor } from "./scheduler.js";
import type { Model } from "../types.js";
import type { Profile } from "../config/schema.js";

const A = { id: "a", displayName: "Model-A" } as unknown as Model;
const B = { id: "b", displayName: "Model-B" } as unknown as Model;

const tick = () => new Promise((r) => setImmediate(r));

function harness(loaded: Model | null) {
  const supervisor = {
    state: loaded ? "ready" : "stopped",
    model: loaded || null,
  } as unknown as SchedulerSupervisor;
  const switches: string[] = [];
  const loadModel = async (m: Model) => {
    switches.push(m.id);
    supervisor.state = "ready";
    supervisor.model = m;
  };
  return { supervisor, switches, loadModel };
}

test("serves the resident model batch first, then switches to the other", async () => {
  const { supervisor, switches, loadModel } = harness(A);
  const sched = new Scheduler({ supervisor, loadModel });

  const order: string[] = [];
  const run = (tag: string) => () => {
    order.push(tag);
    return Promise.resolve();
  };
  // Submitted together (same tick) → A1 and A2 share A's turn (default slots=1
  // keeps them ordered), then B's turn.
  await Promise.all([
    sched.submit(A, run("A1")),
    sched.submit(B, run("B1")),
    sched.submit(A, run("A2")),
    sched.submit(B, run("B2")),
  ]);

  assert.deepEqual(order, ["A1", "A2", "B1", "B2"], "A batch first (already loaded), then B batch");
  assert.deepEqual(switches, ["b"], "only one switch - to B; A was already resident");
});

test("runs up to parallelSlots requests of the resident model at once", async () => {
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: 3 } as Profile,
  } as SchedulerSupervisor;
  const sched = new Scheduler({ supervisor, loadModel: async () => {} });

  let active = 0;
  let peak = 0;
  const job = () => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await tick();
    await tick();
    active -= 1;
  };
  await Promise.all(Array.from({ length: 6 }, () => sched.submit(A, job())));

  assert.equal(peak, 3, "never more than parallelSlots concurrent; the rest wait for a slot");
});

test("loads the requested model when a different one is resident", async () => {
  const { supervisor, switches, loadModel } = harness(A);
  const sched = new Scheduler({ supervisor, loadModel });

  let served = null;
  await sched.submit(B, () => {
    served = supervisor.model!.id;
    return Promise.resolve();
  });

  assert.equal(served, "b", "B was loaded before its job ran");
  assert.deepEqual(switches, ["b"]);
});

test("alternates turns so a steady stream of A does not starve B", async () => {
  const { supervisor, switches, loadModel } = harness(A);
  const sched = new Scheduler({ supervisor, loadModel });

  const order: string[] = [];
  let releaseA1!: () => void;
  const a1 = new Promise<void>((r) => {
    releaseA1 = r;
  });

  const p1 = sched.submit(A, () => {
    order.push("A1");
    return a1;
  });
  await tick(); // A1's turn is now in flight (snapshot was just [A1])

  const p2 = sched.submit(B, () => {
    order.push("B1");
    return Promise.resolve();
  });
  const p3 = sched.submit(A, () => {
    order.push("A2");
    return Promise.resolve();
  });
  await tick();

  releaseA1();
  await Promise.all([p1, p2, p3]);

  assert.deepEqual(order, ["A1", "B1", "A2"], "after A1, B gets a turn before the queued A2");
  assert.deepEqual(switches, ["b", "a"], "switched to B, then back to A");
});

test("an exclusive operation waits behind inference, swaps models, then yields to the next turn", async () => {
  const { supervisor, switches, loadModel } = harness(A);
  const sched = new Scheduler({ supervisor, loadModel });
  const order: string[] = [];
  let releaseA!: () => void;
  const firstA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });

  const request = sched.submit(A, () => {
    order.push("api A1");
    return firstA;
  });
  await tick();
  const calibrate = sched.submit(
    B,
    () => {
      order.push(`calibrate ${supervisor.model?.id}`);
      return Promise.resolve();
    },
    { kind: "calibrate" },
  );
  const nextRequest = sched.submit(A, () => {
    order.push(`api A2 ${supervisor.model?.id}`);
    return Promise.resolve();
  });

  releaseA();
  await Promise.all([request, calibrate, nextRequest]);

  assert.deepEqual(order, ["api A1", "calibrate b", "api A2 a"]);
  assert.deepEqual(switches, ["b", "a"]);
});

test("an operation is a hard queue boundary for later requests to its own model", async () => {
  const { supervisor, loadModel } = harness(A);
  const sched = new Scheduler({ supervisor, loadModel });
  const order: string[] = [];

  await Promise.all([
    sched.submit(A, () => {
      order.push("api before");
      return Promise.resolve();
    }),
    sched.submit(
      A,
      () => {
        order.push("sweep");
        return Promise.resolve();
      },
      { kind: "sweep" },
    ),
    sched.submit(A, () => {
      order.push("api after");
      return Promise.resolve();
    }),
  ]);

  assert.deepEqual(order, ["api before", "sweep", "api after"]);
});

test("a model that fails to load rejects only its own jobs", async () => {
  const supervisor = { state: "stopped", model: null } as unknown as SchedulerSupervisor;
  const switches: string[] = [];
  const loadModel = async (m: Model) => {
    if (m.id === "b") throw new Error("will not fit");
    switches.push(m.id);
    supervisor.state = "ready";
    supervisor.model = m;
  };
  const sched = new Scheduler({ supervisor, loadModel });

  const bResult = sched.submit(B, () => Promise.resolve("should not run"));
  let aRan = false;
  const aResult = sched.submit(A, () => {
    aRan = true;
    return Promise.resolve("ok");
  });

  await assert.rejects(bResult, /will not fit/, "B job rejects with the load error");
  assert.equal(await aResult, "ok", "A job still runs");
  assert.ok(aRan);
  assert.deepEqual(switches, ["a"]);
});

test("stats reports the pending queue by model", async () => {
  const { supervisor, loadModel } = harness(A);
  const sched = new Scheduler({ supervisor, loadModel });

  // Hold A's turn open so B stays queued while we read stats.
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  sched.submit(A, () => held);
  await tick();
  sched.submit(B, () => Promise.resolve());
  sched.submit(B, () => Promise.resolve());

  const s = sched.stats();
  assert.equal(s.queued, 2);
  assert.deepEqual(s.waiting, { "Model-B": 2 });
  assert.equal(s.lastTurn, "a");

  release();
  await tick();
});
