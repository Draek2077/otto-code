import { beforeEach, afterEach, describe, test, expect, vi } from "vitest";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkflowHost } from "./host.js";
import { workflowHostFixture, deferred } from "./test-utils/host-fixture.js";
import type { RunPlan } from "@getpaseo/plugin/otto/workflows";

const plan: RunPlan = {
  title: "Reviewed plan",
  phases: [{ id: "work", title: "Work", type: "implement", task: "Implement precisely" }],
};
describe("Workflow host over isolated real persistence and injected agent boundary", () => {
  let f: Awaited<ReturnType<typeof workflowHostFixture>>;
  beforeEach(async () => {
    f = await workflowHostFixture();
  });
  afterEach(async () => {
    await f.cleanup();
  });
  test("construction/review do not allocate a library, start sessions or subscribe", async () => {
    await f.host.review(f.scope, "workspace-1", f.ai, "review-only");
    expect(await readdir(f.home)).toEqual([]);
    expect(await readdir(f.repo)).toEqual([]);
    expect(f.agents.size).toBe(0);
    expect(f.subscriptions()).toBe(0);
  });
  test("Planning and exact owned reservation are durable before the first session/turn", async () => {
    f.hooks.create = async (request) => {
      const journal = await f.host.journal.read();
      expect(journal).toHaveLength(1);
      expect(journal[0].agentIds).toContain(request.agentId);
      const saved = await f.library.read(journal[0].ref);
      expect(saved.document).toMatchObject({
        kind: "run",
        value: { status: "planning", phases: [], conductorAgentId: request.agentId },
      });
      expect(f.turns).toEqual([]);
    };
    const entry = await f.start();
    await expect.poll(() => f.turns.length).toBe(1);
    expect((await f.library.read(entry.ref)).document.value.status).toBe("planning");
    expect(f.subscriptions()).toBe(1);
  });
  test("ordinary conductor turn settlement never finishes Planning; unrelated lifecycle events do nothing", async () => {
    const entry = await f.start();
    await expect.poll(() => f.turns.length).toBe(1);
    f.event("ordinary-chat", "archived");
    f.event(String(entry.document.value.conductorAgentId), "canceled");
    expect((await f.library.read(entry.ref)).document.value.status).toBe("planning");
    expect(f.closed).toEqual([]);
    expect(f.agents.size).toBe(1);
  });
  test("AI plan persists paused and starts no worker until explicit approval; terminal run releases ownership", async () => {
    const initial = await f.start();
    const paused = await f.host.declarePlan(initial.ref, plan);
    expect(paused.document.value.status).toBe("paused");
    expect(paused.document.value.awaitingStartConfirmation).toBe(true);
    expect(f.agents.size).toBe(1);
    await f.host.control(paused.ref, paused.revision, "approve");
    await f.host.settled(paused.ref);
    expect((await f.library.read(paused.ref)).document.value.status).toBe("done");
    expect((await f.library.read(paused.ref)).document.value.awaitingStartConfirmation).toBe(false);
    expect([...f.agents.values()].map((a) => a.role)).toEqual(["conductor", "worker"]);
    expect(await f.host.journal.read()).toEqual([]);
    expect(f.subscriptions()).toBe(0);
    for (const id of f.agents.keys()) expect(f.host.binding(id)).toBeNull();
  });
  test("workers wait for the conductor's accepted plan turn to settle, then deliver one aggregate follow-up", async () => {
    const releaseConductor = deferred<void>();
    f.hooks.turn = async (request) => {
      if (request.role === "conductor" && f.turns.length === 1) await releaseConductor.promise;
      return { failed: false, finalMessage: "Completed" };
    };
    const initial = await f.start();
    try {
      const paused = await f.host.declarePlan(initial.ref, plan);
      await f.host.control(paused.ref, paused.revision, "approve");
      expect(f.agents.size).toBe(1);
      releaseConductor.resolve();
      await f.host.settled(initial.ref);
      expect((await f.library.read(initial.ref)).document.value.status).toBe("done");
      expect([...f.agents.values()].find((a) => a.role === "conductor")?.access).toBe("write");
      expect(
        f.turns.filter((turn) => turn.id === initial.document.value.conductorAgentId),
      ).toHaveLength(2);
    } finally {
      releaseConductor.resolve();
    }
  });
  test("rejected confirmation is canceled, never failed and never creates a worker", async () => {
    const initial = await f.start();
    const paused = await f.host.declarePlan(initial.ref, plan);
    await f.host.control(paused.ref, paused.revision, "reject", undefined, "No thanks");
    await f.host.settled(paused.ref);
    expect((await f.library.read(initial.ref)).document.value).toMatchObject({
      status: "canceled",
      error: "No thanks",
    });
    expect(f.agents.size).toBe(1);
  });
  test("Graph workers persist actual output and close only their dedicated sessions", async () => {
    const entry = await f.start(f.graph);
    await f.host.settled(entry.ref);
    const saved = await f.library.read(entry.ref);
    expect(saved.document.value.status).toBe("done");
    expect(saved.document.value.phases).toMatchObject([
      { id: "worker", status: "done", candidates: [{ summary: "Output from worker" }] },
    ]);
    expect(f.closed.sort()).toEqual([...f.agents.keys()].sort());
    expect(f.notices.length).toBeGreaterThan(0);
    expect(f.turns.filter((turn) => f.agents.get(turn.id)?.role === "conductor")).toHaveLength(1);
  });
  test("unsupported model/access fails before any session or library write", async () => {
    f.hooks.validate = async () => ["Selected provider cannot enforce this access"];
    await expect(f.start(f.graph)).rejects.toMatchObject({ kind: "unsupported" });
    expect(f.agents.size).toBe(0);
    expect(await readdir(f.repo)).toEqual([]);
  });
  test("user cannot use a worker as conductor or replace a declared plan", async () => {
    const entry = await f.start();
    await expect(f.host.declarePlan(entry.ref, plan, "ordinary-chat")).rejects.toMatchObject({
      kind: "invalid",
    });
    await f.host.declarePlan(entry.ref, plan);
    await expect(f.host.declarePlan(entry.ref, plan)).rejects.toMatchObject({ kind: "conflict" });
  });
  test("stale control decisions cannot cancel newer plan state", async () => {
    const entry = await f.start();
    await f.host.declarePlan(entry.ref, plan);
    await expect(f.host.control(entry.ref, entry.revision, "cancel")).rejects.toMatchObject({
      kind: "conflict",
    });
    expect((await f.library.read(entry.ref)).document.value.status).toBe("paused");
  });
  test("same operation returns its captured run, differing launch is refused without extra agents", async () => {
    const first = await f.start();
    const second = await f.start();
    expect(second.ref).toEqual(first.ref);
    const changed = structuredClone(f.ai);
    if (changed.kind !== "ai") throw new Error("Fixture");
    changed.definition.prompt = "Different";
    await expect(f.start(changed)).rejects.toMatchObject({ kind: "conflict" });
    expect(f.agents.size).toBe(1);
  });
  test("cancel during native startup keeps admission and prevents a late turn", async () => {
    const created = deferred<void>();
    const release = deferred<void>();
    f.hooks.create = async () => {
      created.resolve();
      await release.promise;
    };
    const starting = f.start();
    const outcome = starting.then(
      () => null,
      (error: unknown) => error,
    );
    await created.promise;
    const current = (await f.library.list(f.scope, "run")).items[0];
    const entry = await f.library.read(current.ref);
    try {
      await f.host.control(entry.ref, entry.revision, "cancel");
      expect(f.turns).toEqual([]);
      expect(await f.host.journal.read()).toHaveLength(1);
    } finally {
      release.resolve();
    }
    expect(await outcome).toBeInstanceOf(Error);
    await f.host.settled(entry.ref);
    expect(f.turns).toEqual([]);
    expect((await f.library.read(entry.ref)).document.value.status).toBe("canceled");
    expect(await f.host.journal.read()).toEqual([]);
  });
  test("persistence conflict revokes work and retains last durable record/journal for recovery", async () => {
    const entry = await f.start();
    const file = path.join(f.repo, ".otto/workflows/runs", `${entry.ref.id}.json`);
    const peer = JSON.stringify({ ...entry.document.value, title: "Peer edit" });
    await writeFile(file, peer);
    await expect(f.host.declarePlan(entry.ref, plan)).rejects.toMatchObject({ kind: "conflict" });
    expect(await readFile(file, "utf8")).toBe(peer);
    expect(await f.host.journal.read()).toHaveLength(1);
    for (const id of f.agents.keys()) expect(f.host.binding(id)).toBeNull();
  });
  test("restart reconciles only journal-owned agents, never resumes a provider", async () => {
    const entry = await f.start();
    await expect.poll(() => f.turns.length).toBe(1);
    const turnCount = f.turns.length;
    const observer = f.ports.observe;
    const replacement = new WorkflowHost(f.library, { ...f.ports, observe: observer });
    await replacement.initialize();
    expect((await f.library.read(entry.ref)).document.value).toMatchObject({
      status: "failed",
      error: expect.stringContaining("restart"),
    });
    expect(f.turns).toHaveLength(turnCount);
    expect(await replacement.journal.read()).toEqual([]);
    await replacement.close();
  });
  test("two active planning runs bound admission and do not start periodic observation", async () => {
    await f.start(f.ai, "first");
    await f.start(f.ai, "second");
    await expect(f.start(f.ai, "third")).rejects.toMatchObject({ kind: "busy" });
    expect(f.agents.size).toBe(2);
    expect(f.subscriptions()).toBe(1);
  });
  test("failed native construction is terminal failure with retained history, no blind retry", async () => {
    f.hooks.create = async () => {
      throw new Error("Native launch failed");
    };
    await expect(f.start()).rejects.toThrow("Native launch failed");
    const item = (await f.library.list(f.scope, "run")).items[0];
    await f.host.settled(item.ref);
    expect((await f.library.read(item.ref)).document.value.status).toBe("failed");
    expect(f.agents.size).toBe(1);
  });
  test("autonomous delegation shares capacity one without deadlock and keeps actual parent identity", async () => {
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.limits = { ...graph.limits, maxConcurrency: 1, maxAgents: 4 };
    graph.graph.nodes[1].autonomous = true;
    let childId = "",
      parentId = "";
    f.hooks.turn = async (request) => {
      if (request.role === "worker" && !request.delegationDepth) {
        parentId = request.agentId;
        const child = await f.host.delegate(request.agentId, {
          task: "Inspect only",
          access: "read",
        });
        childId = child.agentId;
        expect(child.failed).toBe(false);
      }
      return { failed: false, finalMessage: "Done" };
    };
    const entry = await f.start(graph);
    await f.host.settled(entry.ref);
    expect((await f.library.read(entry.ref)).document.value).toMatchObject({
      status: "done",
      agentCount: 3,
    });
    expect(f.agents.get(childId)).toMatchObject({
      parentAgentId: parentId,
      access: "read",
      delegationDepth: 1,
    });
  });
  test("delegation cap stops child admission, not an unrelated chat or another run", async () => {
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.limits = { ...graph.limits, maxAgents: 2, maxConcurrency: 1 };
    graph.graph.nodes[1].autonomous = true;
    f.hooks.turn = async (request) => {
      if (request.role === "worker")
        await expect(
          f.host.delegate(request.agentId, { task: "Inspect", access: "read" }),
        ).rejects.toThrow("agent limit");
      return { failed: false, finalMessage: "No extra agent was started" };
    };
    const entry = await f.start(graph);
    await f.host.settled(entry.ref);
    expect(f.agents.size).toBe(2);
    await expect(
      f.host.delegate("ordinary-chat", { task: "Inspect", access: "read" }),
    ).rejects.toThrow("no managed");
  });
  test("canceling a Workflow member cascades to its admitted delegation without canceling another chat", async () => {
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.nodes[1].autonomous = true;
    const entered = deferred<string>();
    f.hooks.turn = async (request, _text, signal) => {
      if (request.delegationDepth) {
        entered.resolve(request.parentAgentId!);
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        expect(signal.aborted).toBe(true);
      } else if (request.role === "worker") {
        await expect(
          f.host.delegate(request.agentId, { task: "Inspect", access: "read" }),
        ).rejects.toThrow();
      }
      return { failed: false, finalMessage: "Settled" };
    };
    const entry = await f.start(graph);
    const parent = await entered.promise;
    f.event(parent, "canceled");
    await f.host.settled(entry.ref);
    expect((await f.library.read(entry.ref)).document.value.status).toBe("failed");
    expect(f.canceled).not.toContain("ordinary-chat");
    expect(f.subscriptions()).toBe(0);
  });
  test("canceling a delegation call during startup revokes its late child before any child turn", async () => {
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.nodes[1].autonomous = true;
    const entered = deferred<string>(),
      release = deferred<void>();
    const call = new AbortController();
    f.hooks.create = async (request) => {
      if (request.delegationDepth) {
        entered.resolve(request.agentId);
        await release.promise;
      }
    };
    f.hooks.turn = async (request) => {
      if (request.role === "worker")
        await expect(
          f.host.delegate(request.agentId, { task: "Inspect", access: "read" }, call.signal),
        ).rejects.toThrow();
      return { failed: false, finalMessage: "Parent settled" };
    };
    const entry = await f.start(graph);
    try {
      const child = await entered.promise;
      call.abort(new Error("Caller canceled"));
      release.resolve();
      await f.host.settled(entry.ref);
      expect(f.turns.some((turn) => turn.id === child)).toBe(false);
      expect(f.closed).toContain(child);
    } finally {
      release.resolve();
    }
  });
  test("failed cleanup retains authority/admission until explicit revision-pinned settlement", async () => {
    const entry = await f.start();
    await expect.poll(() => f.turns.length).toBe(1);
    const turns = f.turns.length;
    f.hooks.close = async () => {
      throw new Error("Retained process");
    };
    await f.host.control(entry.ref, entry.revision, "cancel");
    await f.host.settled(entry.ref);
    expect(f.host.status().active[0]).toMatchObject({ recoveryRequired: true, settling: true });
    const canceled = f.canceled.length;
    await expect(f.host.reconcile(entry.ref, "stale")).rejects.toMatchObject({ kind: "conflict" });
    expect(f.canceled).toHaveLength(canceled);
    f.hooks.close = undefined;
    const current = await f.library.read(entry.ref);
    const settled = await f.host.reconcile(entry.ref, current.revision);
    expect(settled.document.value.status).toBe("canceled");
    expect(f.turns).toHaveLength(turns);
    expect(f.host.status().active).toEqual([]);
    expect(await f.host.journal.read()).toEqual([]);
  });
  test("reconciliation is not another control path for a healthy Planning chat", async () => {
    const entry = await f.start();
    const canceled = f.canceled.length;
    await expect(f.host.reconcile(entry.ref, entry.revision)).rejects.toMatchObject({
      kind: "busy",
    });
    expect(f.canceled).toHaveLength(canceled);
  });
  test("Planning/clarification has no execution deadline; admission arms it once", async () => {
    const timer = vi.spyOn(globalThis, "setTimeout");
    try {
      const entry = await f.start();
      const paused = await f.host.declarePlan(entry.ref, plan);
      const deadline = f.ai.kind === "ai" ? f.ai.definition.limits.timeoutMinutes * 60000 : 0;
      expect(timer.mock.calls.filter((call) => call[1] === deadline)).toHaveLength(0);
      await f.host.control(paused.ref, paused.revision, "approve");
      await f.host.settled(paused.ref);
      expect(timer.mock.calls.filter((call) => call[1] === deadline)).toHaveLength(1);
    } finally {
      timer.mockRestore();
    }
  });
  test("an explicit empty node tool allowlist cannot acquire managed delegation authority", async () => {
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.nodes[1].autonomous = true;
    graph.graph.nodes[1].tools = [];
    f.hooks.turn = async (request) => {
      if (request.role === "worker")
        await expect(
          f.host.delegate(request.agentId, { task: "Inspect", access: "read" }),
        ).rejects.toMatchObject({ kind: "unsupported" });
      return { failed: false, finalMessage: "Done" };
    };
    const entry = await f.start(graph);
    await f.host.settled(entry.ref);
    expect(f.agents.size).toBe(2);
  });
  test("full structured results reach downstream nodes while durable status carries compact references", async () => {
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    const answer = "Precise value " + "x".repeat(15000);
    graph.graph.nodes[1].output = { fields: [{ key: "answer", type: "string" }] };
    graph.graph.nodes.push({
      id: "second",
      kind: "agent",
      title: "Use the full value",
      prompt: "Use the supplied answer",
    });
    graph.graph.edges?.push({ from: "worker", to: "second", fields: ["answer"] });
    let downstream = false;
    f.hooks.turn = async (request, text) => {
      if (request.outputFields)
        return { failed: false, finalMessage: "Result ready", submittedOutput: { answer } };
      if (request.role === "worker") {
        expect(text).toContain(answer);
        downstream = true;
      }
      return { failed: false, finalMessage: "Done" };
    };
    const entry = await f.start(graph);
    await f.host.settled(entry.ref);
    const saved = await f.library.read(entry.ref);
    if (saved.document.kind !== "run") throw new Error("Fixture");
    expect(saved.document.value.status).toBe("done");
    expect(downstream).toBe(true);
    const candidate = saved.document.value.phases[0].candidates![0];
    expect(candidate.outputFields).toBeUndefined();
    expect(
      (await f.host.outputs.read(saved.ref, candidate.agentId, candidate.outputRevision!)).fields,
    ).toEqual({ answer });
  });
  test("a saved Graph edit after review invalidates start before a session is created", async () => {
    if (f.graph.kind !== "graph") throw new Error("Fixture");
    const original = await f.library.write(f.scope, { kind: "graph", value: f.graph.graph }, null);
    if (original.document.kind !== "graph") throw new Error("Fixture");
    const launch = {
      ...f.graph,
      graph: original.document.value,
      source: { ref: original.ref, revision: original.revision },
    };
    const review = await f.host.review(f.scope, "workspace-1", launch, "saved-source");
    await f.library.write(
      f.scope,
      { kind: "graph", value: { ...original.document.value, name: "Peer edit" } },
      original.revision,
      original.ref,
    );
    await expect(f.host.start(f.scope, review.token, "saved-source")).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(f.agents.size).toBe(0);
    expect((await f.library.list(f.scope, "run")).items).toEqual([]);
  });
  test("saved AI launches freeze separate seat overrides without changing the saved definition", async () => {
    if (f.ai.kind !== "ai") throw new Error("Fixture");
    const saved = await f.library.write(f.scope, { kind: "ai", value: f.ai.definition }, null);
    if (saved.document.kind !== "ai") throw new Error("Fixture");
    const seats = {
      ...saved.document.value.seats,
      conductor: { provider: "other", model: "specific" },
    };
    const review = await f.host.review(
      f.scope,
      "workspace-1",
      {
        kind: "ai",
        definition: saved.document.value,
        seats,
        source: { ref: saved.ref, revision: saved.revision },
      },
      "seat-override",
    );
    await f.host.start(f.scope, review.token, "seat-override");
    expect([...f.agents.values()][0].seat).toEqual(seats.conductor);
    expect((await f.library.read(saved.ref)).document.value.seats).toEqual(f.ai.definition.seats);
  });
  test("pending reviews have a bounded token budget and do not create sessions", async () => {
    for (let index = 0; index < 16; index++)
      await f.host.review(f.scope, "workspace-1", f.ai, `review-${index}`);
    await expect(f.host.review(f.scope, "workspace-1", f.ai, "over-budget")).rejects.toMatchObject({
      kind: "busy",
    });
    expect(f.agents.size).toBe(0);
    expect(await readdir(f.home)).toEqual([]);
  });
  test("shutdown drains an admission paused before its first durable run and cannot start a late provider", async () => {
    const entered = deferred<void>(),
      release = deferred<void>(),
      write = f.library.write.bind(f.library);
    const held = vi.spyOn(f.library, "write").mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return write(...args);
    });
    const pending = f.start().catch((error) => error);
    await entered.promise;
    let stopped = false;
    const stopping = f.host.close().then(() => {
      stopped = true;
      return undefined;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stopped).toBe(false);
      expect(f.agents.size).toBe(0);
      release.resolve();
      expect(await pending).toBeInstanceOf(Error);
      await stopping;
      expect(f.agents.size).toBe(0);
      expect(await f.host.journal.read()).toEqual([]);
    } finally {
      release.resolve();
      held.mockRestore();
    }
  });
  test("a provider-catalog reply after shutdown cannot revive a review token", async () => {
    const entered = deferred<void>(),
      release = deferred<void>();
    f.hooks.validate = async () => {
      entered.resolve();
      await release.promise;
      return [];
    };
    const review = f.host
      .review(f.scope, "workspace-1", f.ai, "late-review")
      .catch((error) => error);
    await entered.promise;
    await f.host.close();
    release.resolve();
    expect(await review).toBeInstanceOf(Error);
    expect(f.agents.size).toBe(0);
    expect(await readdir(f.home)).toEqual([]);
  });
});
