import { rmSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { z } from "zod/v3";
import { createEngineFixture } from "../../test-engine.js";
import { BrainConfigSchema, ProfilesStoreSchema } from "../config/schema.js";
import { HostEngine } from "./engine.js";
import { startService } from "./serve.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});

async function host(maxLoadedModels = 2, lockModel = false, runtimeInstalled = false) {
  const fixtures = [await createEngineFixture(), await createEngineFixture()];
  const models = fixtures.map((fixture, index) => ({
    ...fixture.model,
    id: `fixture/model-${index}`,
    displayName: `Fixture ${index}`,
  }));
  let creations = 0;
  let scans = 0;
  let profiles = ProfilesStoreSchema.parse({});
  let engine!: HostEngine;
  const config = BrainConfigSchema.parse({
    listen: { port: 0 },
    maxLoadedModels,
    lockModel,
    lockedModels: lockModel ? [models[0]!.id] : [],
  });
  const service = await startService({
    config,
    env: { OTTO_HOME: fixtures[0]!.root },
    createRuntime: (context) => {
      engine = new HostEngine(context, {
        scan: () => {
          scans++;
          return models;
        },
        profiles: () => structuredClone(profiles),
        saveProfiles: (next) => {
          profiles = structuredClone(next);
        },
        gpu: async () => null,
        runtime: () => (runtimeInstalled ? fixtures[0]!.supervisor.runtime : null),
        runtimeList: () => [],
        createSupervisor: async () => fixtures[creations++]!.supervisor,
      });
      return engine;
    },
  });
  cleanup.push(async () => {
    await service.stop();
    for (const fixture of fixtures) rmSync(fixture.root, { recursive: true, force: true });
  });
  return {
    service,
    engine,
    models,
    base: `http://127.0.0.1:${service.port}`,
    creations: () => creations,
    scans: () => scans,
  };
}

function post(
  base: string,
  model: string,
  extra: Record<string, unknown> = {},
  signal?: AbortSignal,
) {
  return fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: "Bearer private-fixture-token",
      "x-api-key": "private-fixture-key",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "synthetic fixture" }],
      ...extra,
    }),
  });
}

it("keeps an empty host inert and reports only implemented management capabilities", async () => {
  const fixture = await host();
  expect(fixture.creations()).toBe(0);
  expect(fixture.scans()).toBe(0);
  expect(await (await fetch(`${fixture.base}/__host/status`)).json()).toMatchObject({
    state: "stopped",
    running: true,
    residents: [],
    instanceId: expect.any(String),
  });
  expect(fixture.scans()).toBe(0);
  expect(await (await fetch(`${fixture.base}/__host/capabilities`)).json()).toMatchObject({
    load: true,
    events: true,
    profiles: true,
    jobs: true,
    inventory: true,
    runtimes: true,
    writable: false,
  });
  expect(fixture.creations()).toBe(0);
  const runtimeInventory = z
    .object({ runtimes: z.array(z.unknown()) })
    .parse(await (await fetch(`${fixture.base}/__host/runtimes`)).json());
  expect(runtimeInventory.runtimes).toEqual([]);
  expect(fixture.scans()).toBe(0);
});

it("exposes catalog acquisition without loading a model and rejects an unsafe plan before transfer", async () => {
  const fixture = await host();
  const catalog = z
    .object({ models: z.array(z.object({ id: z.string() })) })
    .parse(await (await fetch(`${fixture.base}/__host/catalog`)).json());
  expect(catalog.models.length).toBeGreaterThan(0);
  const admission = await fetch(`${fixture.base}/__host/jobs/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelId: catalog.models[0]!.id, file: "../../outside.gguf" }),
  });
  expect(admission.status).toBe(202);
  const admitted = z.object({ job: z.object({ id: z.string() }) }).parse(await admission.json());
  expect(await fixture.engine.jobs.wait(admitted.job.id)).toMatchObject({
    state: "failed",
    error: "Brain operation failed",
  });
  expect(fixture.creations()).toBe(0);
  expect(fixture.engine.pool.residentSupervisors()).toEqual([]);
});

it("updates profiles by revision and refuses stale writes, browser writes and unsupported jobs", async () => {
  const fixture = await host();
  const route = `${fixture.base}/__host/model/profile?id=${encodeURIComponent(fixture.models[0]!.id)}`;
  const original = z.object({ revision: z.string() }).parse(await (await fetch(route)).json());
  const save = (revision: string, origin?: string) =>
    fetch(route, {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: JSON.stringify({ expectedRevision: revision, patch: { temperature: 0.4 } }),
    });
  expect((await save(original.revision, "https://fixture.invalid")).status).toBe(403);
  expect(
    (
      await fetch(`${fixture.base}/__host/model?id=${encodeURIComponent(fixture.models[0]!.id)}`, {
        method: "DELETE",
        headers: { origin: "https://fixture.invalid" },
      })
    ).status,
  ).toBe(403);
  const saved = await save(original.revision);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ profile: { temperature: 0.4 } });
  expect((await save(original.revision)).status).toBe(409);
  expect(
    (
      await fetch(`${fixture.base}/__host/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "arbitrary-command", modelId: fixture.models[0]!.id }),
      })
    ).status,
  ).toBe(400);
  expect(fixture.engine.jobs.list()).toEqual([]);
  expect(fixture.creations()).toBe(0);
});

it("rejects malformed or misplaced sweep budgets before creating a host job", async () => {
  const fixture = await host();
  for (const options of [
    { operation: "sweep", budgets: [] },
    { operation: "sweep", budgets: [1.5] },
    { operation: "sweep", budgets: [-2] },
    { operation: "sweep", budgets: Array.from({ length: 65 }, () => 1) },
    { operation: "calibrate", budgets: [0] },
  ]) {
    const response = await fetch(`${fixture.base}/__host/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId: fixture.models[0]!.id, ...options }),
    });
    expect(response.status).toBe(400);
  }
  expect(fixture.engine.jobs.list()).toEqual([]);
  expect(fixture.creations()).toBe(0);
});

it("reports unapplied saved settings and applies them through an exclusive explicit reload", async () => {
  const fixture = await host(1, false, true);
  const id = fixture.models[0]!.id;
  const route = `${fixture.base}/__host/model/profile?id=${encodeURIComponent(id)}`;
  const profileSchema = z.object({ revision: z.string(), requiresRestart: z.boolean() });
  const original = profileSchema.parse(await (await fetch(route)).json());
  expect(original.requiresRestart).toBe(false);
  const load = () =>
    fetch(`${fixture.base}/__host/model/load?id=${encodeURIComponent(id)}`, { method: "POST" });
  expect((await load()).status).toBe(200);
  expect(fixture.creations()).toBe(1);
  expect((await load()).status).toBe(200);
  expect(fixture.creations()).toBe(1);
  const saved = await fetch(route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: original.revision, patch: { temperature: 0.4 } }),
  });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({
    requiresRestart: true,
    budget: null,
    maxContextThatFits: null,
    profile: { temperature: 0.4 },
  });
  expect((await load()).status).toBe(200);
  expect(fixture.creations()).toBe(2);
  expect(fixture.engine.pool.supervisorFor(id)?.profile?.temperature).toBe(0.4);
  expect(profileSchema.parse(await (await fetch(route)).json()).requiresRestart).toBe(false);
});

it("serves a host-owned inventory with model identities and revisions without launching a runtime", async () => {
  const fixture = await host();
  const response = await fetch(`${fixture.base}/__host/models`);
  expect(response.status).toBe(200);
  const inventory = z
    .object({ models: z.array(z.record(z.unknown())) })
    .parse(await response.json());
  expect(inventory.models).toHaveLength(2);
  expect(inventory.models[0]).toMatchObject({
    id: fixture.models[0]!.id,
    state: "not-loaded",
    revision: expect.any(String),
    repo: null,
    catalogOwned: false,
  });
  expect(inventory.models[0]).not.toHaveProperty("modelPath");
  expect(fixture.creations()).toBe(0);
  expect(fixture.scans()).toBe(1);
});

it("serves two models through distinct owned residents and never forwards host credentials or caller slot pins", async () => {
  const fixture = await host();
  const replies = await Promise.all(
    fixture.models.map((model) => post(fixture.base, model.id, { id_slot: 999 })),
  );
  for (const [index, response] of replies.entries()) {
    expect(response.status).toBe(200);
    const reply = z
      .object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })) })
      .parse(await response.json());
    const parsed = z
      .object({ body: z.record(z.unknown()), headers: z.record(z.unknown()) })
      .parse(JSON.parse(reply.choices[0]!.message.content));
    expect(parsed.body).toMatchObject({ model: fixture.models[index]!.id, id_slot: 0 });
    expect(parsed.headers.authorization).toBeUndefined();
    expect(parsed.headers["x-api-key"]).toBeUndefined();
  }
  const snapshot = await fixture.engine.snapshot();
  const residents = snapshot.residents as Array<{ residentId: string; modelId: string }>;
  expect(residents.map((resident) => resident.modelId).sort()).toEqual(
    fixture.models.map((model) => model.id).sort(),
  );
  expect(new Set(residents.map((resident) => resident.residentId)).size).toBe(2);
  expect(fixture.creations()).toBe(2);
  expect(fixture.scans()).toBe(1);
});

it("rejects unselected models and malformed bodies before creating a native owner", async () => {
  const fixture = await host(1, true);
  expect((await post(fixture.base, fixture.models[1]!.id)).status).toBe(409);
  expect(
    (
      await fetch(`${fixture.base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      })
    ).status,
  ).toBe(400);
  expect(fixture.creations()).toBe(0);
});

it("retains busy inference, releases it on disconnect and erases a slot before another session uses it", async () => {
  const fixture = await host(1);
  const model = fixture.models[0]!;
  const controller = new AbortController();
  const streamed = await post(
    fixture.base,
    model.id,
    { stream: true, prompt_cache_key: "first" },
    controller.signal,
  );
  const reader = streamed.body!.getReader();
  await reader.read();
  const snapshot = await fixture.engine.snapshot();
  expect((snapshot.residents as Array<{ inference: unknown }>)[0]!.inference).toMatchObject({
    thinking: 1,
    slotStages: { "0": "thinking" },
  });
  expect((await fetch(`${fixture.base}/__host/model/unload`, { method: "POST" })).status).toBe(503);
  controller.abort();
  await reader.cancel().catch(() => undefined);
  const response = await post(fixture.base, model.id, { prompt_cache_key: "second" });
  expect(response.status).toBe(200);
  await response.arrayBuffer();
  const resident = fixture.engine.pool.residentSupervisors()[0]!;
  const history = z
    .array(z.unknown())
    .parse(await (await fetch(`${resident.upstream}/fixture/history`)).json());
  expect(history.map((item: unknown) => (typeof item === "string" ? item : "completion"))).toEqual([
    "completion",
    "erase",
    "completion",
  ]);
  expect(
    ((await fixture.engine.snapshot()).residents as Array<{ inference: unknown }>)[0]!.inference,
  ).toMatchObject({ activeRequests: 0 });
});

it("owns one status subscription per event reader and stops sampling after disconnect", async () => {
  const fixture = await host();
  const controller = new AbortController();
  const events = await fetch(`${fixture.base}/__host/events`, { signal: controller.signal });
  const reader = events.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain("Brain events");
  expect(fixture.engine.events.listenerCount).toBe(1);
  controller.abort();
  await reader.cancel().catch(() => undefined);
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  expect(fixture.engine.events.listenerCount).toBe(0);
});

it("waits for owned model children and active streams before releasing the host", async () => {
  const fixture = await host();
  const response = await post(fixture.base, fixture.models[0]!.id, { stream: true });
  const reading = response.arrayBuffer().catch(() => null);
  await fixture.service.stop();
  await reading;
  expect(fixture.engine.pool.residentSupervisors()).toEqual([]);
  expect(fixture.service.server.listening).toBe(false);
});

it("cancels and settles host jobs before releasing the service lifetime", async () => {
  const fixture = await host();
  let started!: () => void;
  const admission = new Promise<void>((resolve) => {
    started = resolve;
  });
  const job = fixture.engine.jobs.start(
    "pull",
    { modelId: null, catalogModelId: "fixture", repo: null, quant: null },
    async (context) => {
      context.started();
      started();
      await new Promise<void>((resolve) =>
        context.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      context.signal.throwIfAborted();
      return null;
    },
  );
  await admission;
  const detail = z
    .object({ job: z.unknown() })
    .parse(await (await fetch(`${fixture.base}/__host/jobs/status?id=${job.id}`)).json());
  expect(detail.job).toMatchObject({ id: job.id, state: "running" });
  expect((await fetch(`${fixture.base}/__host/jobs/status?id=missing`)).status).toBe(404);
  expect((await fixture.engine.snapshot()).jobRevision).toBeGreaterThan(0);
  await fixture.service.stop();
  expect(await fixture.engine.jobs.wait(job.id)).toMatchObject({
    state: "canceled",
    cancelRequested: true,
  });
  expect(fixture.service.server.listening).toBe(false);
});
