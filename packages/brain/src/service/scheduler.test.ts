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

// --- Session affinity -------------------------------------------------------

const tick2 = () => new Promise((r) => setTimeout(r, 10));

test("a session's next job runs before another session's while its slots stay warm", async () => {
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: 2 } as Profile,
  } as SchedulerSupervisor;
  const sched = new Scheduler({ supervisor, loadModel: async () => {} });

  const order: string[] = [];
  let releaseA1!: () => void;
  const a1 = new Promise<void>((r) => {
    releaseA1 = r;
  });

  // A1 holds one slot; A2 and B1 are already queued behind it.
  const p1 = sched.submit(
    A,
    () => {
      order.push("A1");
      return a1;
    },
    { session: "chatA" },
  );
  await tick();
  const p2 = sched.submit(
    A,
    () => {
      order.push("A2");
      return Promise.resolve();
    },
    { session: "chatA" },
  );
  const p3 = sched.submit(
    A,
    () => {
      order.push("B1");
      return Promise.resolve();
    },
    { session: "chatB" },
  );

  // A1 finishes: chatA's KV state is the warm one, so A2 takes the freed slot
  // before B1 - no eviction, no re-prefill of chatA's context.
  releaseA1();
  await Promise.all([p1, p2, p3]);

  assert.deepEqual(order, ["A1", "A2", "B1"], "the warm session runs next");
});

test("two sessions run concurrently across two slots, each keeping its own", async () => {
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: 2 } as Profile,
  } as SchedulerSupervisor;
  const sched = new Scheduler({ supervisor, loadModel: async () => {} });

  let active = 0;
  let peak = 0;
  const job = (_tag: string, _session: string) => () => {
    active += 1;
    peak = Math.max(peak, active);
    return new Promise<void>((r) => setTimeout(() => ((active -= 1), r()), 10));
  };

  await Promise.all([
    sched.submit(A, job("A1", "chatA"), { session: "chatA" }),
    sched.submit(A, job("B1", "chatB"), { session: "chatB" }),
    sched.submit(A, job("A2", "chatA"), { session: "chatA" }),
    sched.submit(A, job("B2", "chatB"), { session: "chatB" }),
  ]);

  assert.equal(peak, 2, "never more than the two slots");
});

test("a second chat takes the free slot while the first is still streaming", async () => {
  // The agentic traffic pattern: one request per chat per turn, never a burst.
  // A1 is in flight when B1 arrives. B1 must join A1's open turn and take the
  // second slot immediately - a closed per-turn batch made it wait for A1 to
  // finish, which is the two-chats-trading-one-slot symptom.
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: 2 } as Profile,
  } as SchedulerSupervisor;
  const sched = new Scheduler({ supervisor, loadModel: async () => {} });

  let active = 0;
  let peak = 0;
  const started: string[] = [];
  const job = (tag: string, done: Promise<void>) => async () => {
    active += 1;
    peak = Math.max(peak, active);
    started.push(tag);
    await done;
    active -= 1;
  };

  let releaseA1!: () => void;
  let releaseB1!: () => void;
  const a1 = new Promise<void>((r) => (releaseA1 = r));
  const b1 = new Promise<void>((r) => (releaseB1 = r));

  const pA1 = sched.submit(A, job("A1", a1), { session: "chatA" });
  await tick(); // A1 in flight, one slot still free

  const pB1 = sched.submit(A, job("B1", b1), { session: "chatB" });
  await tick(); // B1 joins the open turn rather than waiting for A1's to end
  assert.equal(active, 2, "both chats are streaming at the same time");

  releaseA1();
  const pA2 = sched.submit(A, job("A2", Promise.resolve()), { session: "chatA" });
  releaseB1();
  await Promise.all([pA1, pB1, pA2]);

  assert.equal(peak, 2, "both slots were live at once");
  assert.deepEqual(started.slice(0, 2), ["A1", "B1"], "A1 first, then B1 before A1 finished");
  assert.equal(started.indexOf("A2"), 2, "A2 ran last, after both predecessors had started");
});

test("a live slot sample does not double-count the jobs already in flight", async () => {
  // Production shape: llama-server's /slots idle count already excludes our
  // running jobs. Subtracting them from it a second time leaves zero capacity
  // as soon as one chat is live, which serializes every other chat onto that
  // one slot while the Overview honestly reports 1/2 in use.
  const TOTAL = 2;
  let busy = 0;
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: TOTAL } as Profile,
  } as SchedulerSupervisor;
  const sched = new Scheduler({
    supervisor,
    loadModel: async () => {},
    freeSlots: () => TOTAL - busy,
  });

  let peak = 0;
  const job = (done: Promise<void>) => async () => {
    busy += 1;
    peak = Math.max(peak, busy);
    await done;
    busy -= 1;
  };

  let releaseA1!: () => void;
  let releaseB1!: () => void;
  const a1 = new Promise<void>((r) => (releaseA1 = r));
  const b1 = new Promise<void>((r) => (releaseB1 = r));

  const pA1 = sched.submit(A, job(a1), { session: "chatA" });
  await tick2();
  const pB1 = sched.submit(A, job(b1), { session: "chatB" });
  await tick2();

  assert.equal(busy, 2, "the engine reported one idle slot and it was used");

  releaseA1();
  releaseB1();
  await Promise.all([pA1, pB1]);
  assert.equal(peak, 2, "two slots, two concurrent chats");
});

test("a third chat waits for a slot and runs as soon as one frees", async () => {
  // Two slots, three chats: the extra chat must queue rather than pile a third
  // sequence onto a two-slot KV pool, and must start the moment a slot frees.
  const TOTAL = 2;
  let busy = 0;
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: TOTAL } as Profile,
  } as SchedulerSupervisor;
  const sched = new Scheduler({
    supervisor,
    loadModel: async () => {},
    freeSlots: () => TOTAL - busy,
    slotPollMs: 5,
  });

  let peak = 0;
  const started: string[] = [];
  const job = (tag: string, done: Promise<void>) => async () => {
    busy += 1;
    peak = Math.max(peak, busy);
    started.push(tag);
    await done;
    busy -= 1;
  };

  const release: Record<string, () => void> = {};
  const held = (tag: string) =>
    new Promise<void>((r) => {
      release[tag] = r;
    });
  const [hA, hB, hC] = [held("A"), held("B"), held("C")];

  const pA = sched.submit(A, job("A", hA), { session: "chatA" });
  await tick2();
  const pB = sched.submit(A, job("B", hB), { session: "chatB" });
  await tick2();
  const pC = sched.submit(A, job("C", hC), { session: "chatC" });
  await tick2();

  assert.deepEqual(started, ["A", "B"], "the third chat waits for a slot");
  assert.equal(sched.stats().queued, 1, "and is reported as waiting, not lost");

  release.A();
  await tick2();
  assert.deepEqual(started, ["A", "B", "C"], "it starts the moment a slot frees");

  release.B();
  release.C();
  await Promise.all([pA, pB, pC]);
  assert.equal(peak, 2, "never more than the two slots");
});

test("a queued different model gets its turn once the open turn drains", async () => {
  // Two slots: A1 holds one and the turn stays open on the other. B1 lands on
  // that open turn - it must end the turn rather than hold it open, or the
  // scheduler would never switch models and B would starve.
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: 2 } as Profile,
  } as SchedulerSupervisor;
  const switches: string[] = [];
  const sched = new Scheduler({
    supervisor,
    loadModel: async (m: Model) => {
      switches.push(m.id);
      supervisor.state = "ready";
      supervisor.model = m;
    },
  });

  const order: string[] = [];
  let releaseA!: () => void;
  const a1 = new Promise<void>((r) => {
    releaseA = r;
  });

  const p1 = sched.submit(A, () => {
    order.push("A1");
    return a1;
  });
  await tick(); // A1 in flight, A's turn open on the second slot

  const p2 = sched.submit(B, () => {
    order.push("B1");
    return Promise.resolve();
  });
  await tick(); // B1 is at the head, so A's turn stops absorbing

  releaseA();
  await Promise.all([p1, p2]);

  assert.deepEqual(order, ["A1", "B1"], "B was served after A finished");
  assert.deepEqual(switches, ["b"], "model switched to B");
});

// --- Live slot admission ------------------------------------------------------

test("waits for a free slot instead of dispatching into a saturated engine", async () => {
  const { supervisor, loadModel } = harness(A);
  let free = 0; // the engine reports every slot busy
  const sched = new Scheduler({
    supervisor,
    loadModel,
    freeSlots: () => free,
    slotPollMs: 20,
  });

  let ran = false;
  const p = sched.submit(A, () => {
    ran = true;
    return Promise.resolve();
  });
  await tick2();
  assert.equal(ran, false, "no dispatch while /slots reports zero free");
  assert.equal(sched.stats().queued, 1, "the job stays queued, not lost");

  free = 1; // a slot frees up
  await p;
  assert.equal(ran, true, "dispatched once a slot was actually free");
});

test("falls back to the profile count when the slot sample is unavailable", async () => {
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: 3 } as Profile,
  } as SchedulerSupervisor;
  const sched = new Scheduler({
    supervisor,
    loadModel: async () => {},
    freeSlots: () => null, // sampler failed
  });

  let active = 0;
  let peak = 0;
  const job = () => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await tick2();
    active -= 1;
  };
  await Promise.all(Array.from({ length: 5 }, () => sched.submit(A, job())));

  assert.equal(peak, 3, "the static ceiling still bounds concurrency");
});

test("never dispatches more jobs than slots, across a long burst", async () => {
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: 2 } as Profile,
  } as SchedulerSupervisor;
  let free = 2;
  const sched = new Scheduler({
    supervisor,
    loadModel: async () => {},
    freeSlots: () => free,
  });

  let active = 0;
  let peak = 0;
  const job = () => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
  };
  await Promise.all(Array.from({ length: 12 }, () => sched.submit(A, job())));

  assert.equal(peak, 2, "the measured slot count is the hard ceiling");
});
