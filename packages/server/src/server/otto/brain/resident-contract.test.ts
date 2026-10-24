/** Node HTTP fixture only: no native runtime, model inference, GPU probe or installed home. */
import { rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { startService } from "@getpaseo/brain/host";
import { BrainConfigSchema, ProfilesStoreSchema } from "@getpaseo/brain/config";
import { BrainStatusSchema } from "@getpaseo/protocol/otto/brain";
import { BrainInventorySchema } from "@getpaseo/protocol/otto/brain-library";
import { parseModels } from "@getpaseo/plugin/server/otto-openai";
import { createEngineFixture } from "../../../../../otto-brain/test-engine.js";
import { fixtureRoot } from "../../../../../otto-brain/test-fixtures.js";
import { HostEngine } from "../../../../../otto-brain/src/service/engine.js";

test("a real resident projection and live slot fit the application contract using a synthetic HTTP engine", async () => {
  const fixture = await createEngineFixture();
  const relative = path.relative(fixtureRoot(), fixture.root);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Unexpected fixture cleanup path");
  let constructions = 0;
  const host = await startService({
    env: { OTTO_HOME: fixture.root },
    config: BrainConfigSchema.parse({ listen: { port: 0 } }),
    createRuntime: (context) =>
      new HostEngine(context, {
        scan: () => [fixture.model],
        profiles: () => ProfilesStoreSchema.parse({}),
        runtime: () => fixture.supervisor.runtime,
        runtimeList: () => [],
        results: () => [],
        gpu: async () => null,
        createSupervisor: async () => {
          constructions++;
          return fixture.supervisor;
        },
      }),
  });
  const signal = new AbortController();
  const base = `http://127.0.0.1:${host.port}`;
  try {
    expect(constructions).toBe(0);
    const loaded = await fetch(
      `${base}/__host/model/load?id=${encodeURIComponent(fixture.model.id)}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    expect(loaded.ok).toBe(true);
    expect(constructions).toBe(1);
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      signal: signal.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: fixture.model.id,
        stream: true,
        messages: [{ role: "user", content: "synthetic fixture" }],
      }),
    });
    expect(response.ok).toBe(true);
    const snapshot = BrainStatusSchema.parse(await (await fetch(`${base}/__host/status`)).json());
    expect(snapshot.residents).toHaveLength(1);
    expect(snapshot.residents[0]).toMatchObject({
      modelId: fixture.model.id,
      state: "ready",
      slots: { busy: 1, decode: 1, threads: [{ slot: 0, phase: "decode" }] },
      inference: { thinking: 1, slotStages: { "0": "thinking" } },
    });
    const inventory = BrainInventorySchema.parse(
      await (await fetch(`${base}/__host/models`)).json(),
    );
    expect(inventory.models[0]).toMatchObject({ id: fixture.model.id, state: "active" });
    expect(JSON.stringify(inventory)).not.toContain(fixture.model.modelPath);
    const models = parseModels(await (await fetch(`${base}/v1/models`)).json());
    const activeProfile = fixture.supervisor.profile;
    if (!activeProfile) throw new Error("Synthetic resident profile missing");
    expect(models[0]).toMatchObject({
      id: fixture.model.id,
      label: fixture.model.displayName,
      contextWindowMaxTokens: Math.max(
        1,
        Math.floor(activeProfile.contextSize / activeProfile.parallelSlots),
      ),
    });
    signal.abort();
    const completed = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: fixture.model.id,
        messages: [{ role: "user", content: "synthetic buffered fixture" }],
      }),
    });
    expect(completed.ok).toBe(true);
    await completed.text();
    const after = BrainStatusSchema.parse(await (await fetch(`${base}/__host/status`)).json());
    expect(after.telemetry).toMatchObject({ requests: 2, ok: 1, reasoningOnly: 0, truncated: 0 });
  } finally {
    signal.abort();
    await host.stop();
    await fixture.supervisor.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
