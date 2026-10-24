import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { afterEach, expect, it, vi } from "vitest";
import { createEngineFixture } from "../../test-engine.js";
import { BrainConfigSchema, ProfilesStoreSchema } from "../config/schema.js";
import { HostEngine } from "../service/engine.js";
import { startService } from "../service/serve.js";
import { readPidFile } from "../service/pid-lock.js";
import { localBrainRequest } from "../service/local-client.js";
import { localJobTransport } from "../service/job-client.js";
import { renderResult } from "../output/render.js";
import { withBrainCommandHost } from "./target.js";
import { runScanCommand } from "./scan.js";

const command = undefined as unknown as Command;
const output = { format: "table", quiet: false, noHeaders: false, noColor: true } as const;
afterEach(() => vi.unstubAllEnvs());

it("scans the read-only owning host without GPU probes or launches and preserves full metadata after a quick scan", async () => {
  const fixture = await createEngineFixture();
  const fullModel = {
    ...fixture.model,
    displayName: "Owner model",
    metadata: { ...fixture.model.metadata, arch: "fixture", contextLength: 4096 },
  };
  const quickModel = { ...fullModel, metadata: null };
  const scan = vi.fn((options?: { withMetadata?: boolean }) => [
    options?.withMetadata === false ? quickModel : fullModel,
  ]);
  const gpu = vi.fn(async () => null);
  const launch = vi.fn(async () => {
    throw new Error("A listing must not launch a runtime");
  });
  const config = BrainConfigSchema.parse({ listen: { port: 0 }, allowRemoteConfig: false });
  const env = { OTTO_HOME: fixture.root };
  let engine!: HostEngine;
  const service = await startService({
    config,
    env,
    createRuntime: (context) =>
      (engine = new HostEngine(context, {
        scan,
        gpu,
        createSupervisor: launch,
        profiles: () => ProfilesStoreSchema.parse({}),
        runtime: () => null,
        runtimeList: () => [],
        results: () => [],
        ranking: () => [],
      })),
  });
  try {
    const record = readPidFile(env);
    if (!record) throw new Error("Fixture owner did not acquire its home");
    const local = { record, config, env };
    const clientHome = path.join(fixture.root, "untouched-client");
    vi.stubEnv("OTTO_HOME", clientHome);
    const port = {
      ...localJobTransport(local),
      request: (route: string, signal: AbortSignal, body?: unknown) =>
        localBrainRequest(local, route, body, signal),
    };
    const full = await withBrainCommandHost(port, () => runScanCommand({}, command));
    expect(full.data).toMatchObject([{ model: "Owner model", arch: "fixture", ctx: "4096" }]);
    expect(renderResult(full, output)).toContain("MODEL");
    expect(renderResult(full, { ...output, format: "yaml" })).toContain("Owner model");
    const quick = await withBrainCommandHost(port, () =>
      runScanCommand({ metadata: false }, command),
    );
    expect(quick.data).toMatchObject([{ arch: "-", ctx: "-" }]);
    expect(JSON.parse(renderResult(quick, { ...output, format: "json" }))[0].model).toBe(
      "Owner model",
    );
    expect(scan.mock.calls).toEqual([[{ withMetadata: true }], [{ withMetadata: false }]]);
    expect(engine.models()[0]).toBe(fullModel);
    expect(gpu).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(fs.existsSync(clientHome)).toBe(false);
    for (const query of ["metadata=0", "metadata=false&metadata=true", "metadata=true&extra=1"])
      await expect(
        port.request(`/__host/models/discover?${query}`, AbortSignal.timeout(3000)),
      ).rejects.toThrow();
    expect(scan).toHaveBeenCalledTimes(2);
  } finally {
    await service.stop();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

it("requires owner scan capability without falling back to invoker discovery", async () => {
  const request = vi.fn(async (_route: string) => ({}));
  await expect(
    withBrainCommandHost(
      {
        instanceId: "older-owner",
        request,
        events: async () => undefined,
      },
      () => runScanCommand({}, command),
    ),
  ).rejects.toMatchObject({ code: "UPDATE_HOST" });
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0]?.[0]).toBe("/__host/capabilities");
});
