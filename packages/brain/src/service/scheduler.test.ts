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

// --- Slot pinning -------------------------------------------------------------
// The ids handed out here become `id_slot` on the outbound completion, which is
// what lets the host attribute a request's stage ("thinking", which llama-server
// cannot report) to the exact slot row the Overview panel draws.

test("hands each concurrently admitted job a distinct slot id", async () => {
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: 2 } as Profile,
  } as SchedulerSupervisor;
  const sched = new Scheduler({
    supervisor,
    loadModel: async () => {},
    freeSlots: () => ({ idle: 2, ids: [0, 1] }),
  });

  const pinned: Array<number | null> = [];
  const job = () => async () => {
    await new Promise((r) => setTimeout(r, 5));
  };
  await Promise.all(
    Array.from({ length: 2 }, () =>
      sched.submit(A, job(), { onSlotFree: (id) => pinned.push(id) }),
    ),
  );

  assert.deepEqual(pinned.slice().sort(), [0, 1], "two jobs, two different slots");
});

test("does not re-offer a slot a running job already holds", async () => {
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: 2 } as Profile,
  } as SchedulerSupervisor;
  // A stale sample: the engine still reports slot 0 idle because the job
  // admitted to it has not reached llama-server yet.
  const sched = new Scheduler({
    supervisor,
    loadModel: async () => {},
    freeSlots: () => ({ idle: 2, ids: [0, 1] }),
  });

  const pinned: Array<number | null> = [];
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  void sched.submit(A, () => held, { onSlotFree: (id) => pinned.push(id) });
  await tick();
  const second = sched.submit(A, async () => {}, { onSlotFree: (id) => pinned.push(id) });
  await second;
  release();

  assert.deepEqual(pinned, [0, 1], "the second job took the free slot, not slot 0 again");
});

test("reports no pin when the engine answers with a bare count", async () => {
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: 1 } as Profile,
  } as SchedulerSupervisor;
  const sched = new Scheduler({
    supervisor,
    loadModel: async () => {},
    freeSlots: () => 1, // a count with no ids: admission works, no honest pin
  });

  const pinned: Array<number | null> = [];
  await sched.submit(A, async () => {}, { onSlotFree: (id) => pinned.push(id) });

  assert.deepEqual(pinned, [null], "unpinned rather than a guessed slot id");
});

// --- Ownership: a slot's KV belongs to the chat that last ran on it ---------
// The cross-chat bleed fix. The scheduler erases a slot's retained KV only
// when it is handed to a DIFFERENT session - never when the same chat reuses
// its own slot, and never at settle (the chat keeps its KV across turns).
//
// The harness mirrors the router's real wiring: the job's onSlotFree callback
// is what receives the slot id the scheduler named at admission (the router
// uses it to pin the completion via `id_slot`), and onStart fires exactly
// when the completion is POSTED to the engine - the moment that must come
// AFTER a handoff erase is acknowledged. A job that never receives onSlotFree
// is never pinned, which is exactly the production shape of a request the
// engine could not sample.
function ownershipHarness(erase: (slotId: number) => Promise<void> | void): {
  sched: Scheduler;
  erased: number[];
  pinned: Array<number | null>;
  order: string[];
  run: (session: string | null) => Promise<unknown>;
} {
  const supervisor = {
    state: "ready",
    model: A,
    profile: { parallelSlots: 1 } as Profile,
  } as SchedulerSupervisor;
  const erased: number[] = [];
  const pinned: Array<number | null> = [];
  const order: string[] = [];
  const sched = new Scheduler({
    supervisor,
    loadModel: async () => {},
    freeSlots: () => ({ idle: 1, ids: [0] }),
    eraseSlot: (slotId) => {
      erased.push(slotId);
      return Promise.resolve(erase(slotId));
    },
  });
  const run = async (session: string | null) => {
    await sched.submit(A, () => Promise.resolve(), {
      ...(session ? { session } : {}),
      onSlotFree: (slotId) => {
        pinned.push(slotId);
      },
      onStart: () => {
        order.push(`posted:${session ?? "keyless"}`);
      },
    });
    order.push(`ran:${session ?? "keyless"}`);
  };
  return { sched, erased, pinned, order, run };
}

test("erases a slot handed from one chat to another, before the job runs", async () => {
  const { erased, pinned, order, run } = ownershipHarness(() => {});

  // Chat A occupies the only slot, settles, keeps its KV in the owner map.
  await run("chat-A");
  assert.equal(erased.length, 0, "the first chat to a fresh slot is never erased");
  assert.deepEqual(pinned, [0], "the slot was named at admission");

  // Chat B is admitted to the SAME slot: the handoff erases it first.
  await run("chat-B");

  assert.deepEqual(erased, [0], "slot 0 erased exactly once, for the handoff");
  assert.deepEqual(
    order,
    ["posted:chat-A", "ran:chat-A", "posted:chat-B", "ran:chat-B"],
    "both chats still ran, B's completion posted only after the handoff",
  );
});

test("does not erase when the same chat reuses its own slot", async () => {
  const { erased, pinned, run } = ownershipHarness(() => {});

  // The same chat takes the slot, settles, and takes it AGAIN: its KV is the
  // whole point of the cache, so no handoff and no erase either time.
  await run("chat-A");
  await run("chat-A");
  await run("chat-A");

  assert.equal(erased.length, 0, "a chat reusing its own slot is never erased");
  assert.deepEqual(pinned, [0, 0, 0], "the same slot, named for the same chat, every time");
});

test("erases when a keyless client touches a slot a keyed chat last owned", async () => {
  const { erased, pinned, run } = ownershipHarness(() => {});

  // A keyed chat fills the slot and settles; its KV stays there.
  await run("chat-A");
  // A third-party client with no prompt_cache_key cannot prove ownership, so
  // the slot must be wiped before it lands there.
  await run(null);

  assert.deepEqual(erased, [0], "the keyless client's first touch erases the slot");
  assert.deepEqual(pinned, [0, 0], "both requests were admitted to the one slot");
});

test("clears the owner map when the engine relaunches the same model", async () => {
  const { sched, erased, pinned, run } = ownershipHarness(() => {});

  await run("chat-A");
  assert.equal(sched.slotOwners.get(0), "chat-A", "the slot is owned before the relaunch");

  // The supervisor's `starting` state is what the router forwards here: the
  // slots are gone, so their owners are void.
  sched.forgetSlots();
  assert.equal(sched.slotOwners.size, 0, "the owner map is empty after a relaunch");

  // A FRESH slot 0 must not be erased just because a stale entry said it was
  // owned - that would force a needless re-prefill on a clean engine.
  await run("chat-B");
  assert.equal(erased.length, 0, "no erase after a relaunch: the slot was fresh");
  assert.deepEqual(pinned, [0, 0], "the fresh slot was named for the new chat");
});

test("a handoff erase failure degrades to the old behavior and never fails the job", async () => {
  const { order, run } = ownershipHarness(() => {
    throw new Error("engine refused");
  });

  await run("chat-A");
  // The eraser throws on the handoff; the job must still run, not reject.
  await run("chat-B");

  assert.deepEqual(
    order,
    ["posted:chat-A", "ran:chat-A", "posted:chat-B", "ran:chat-B"],
    "both ran even though the erase failed",
  );
});

test("the handoff erase is acknowledged BEFORE the job's run reaches the engine", async () => {
  const { order, run } = ownershipHarness(async () => {
    // Simulate the engine: the erase is only "done" when it has reached the
    // engine's task queue. It must be acknowledged before the completion is
    // posted, so the clean state sits in the queue ahead of it.
    await new Promise((r) => setTimeout(r, 5));
    order.push("erase-acked");
  });

  await run("chat-A");
  await run("chat-B");

  assert.deepEqual(
    order,
    ["posted:chat-A", "ran:chat-A", "erase-acked", "posted:chat-B", "ran:chat-B"],
    "the erase lands in the engine's queue ahead of the completion that follows",
  );
});
