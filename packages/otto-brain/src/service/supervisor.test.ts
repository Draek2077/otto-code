import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { Supervisor } from "./supervisor.js";
import { startService } from "./serve.js";
import { resolveBrainPaths } from "../config/paths.js";
import { BrainConfigSchema, ProfilesStoreSchema } from "../config/schema.js";
import { defaultProfile } from "../config/profiles.js";
import { llamaCppRuntimeDriver } from "../runtime/model-server-driver.js";
import type { Model, Runtime } from "../types.js";

const fixtures: { root: string; supervisor: Supervisor }[] = [];
afterEach(async () => {
  for (const { root, supervisor } of fixtures.splice(0)) {
    await supervisor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function fixture(mode = "ready", timeout = 5000) {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-model-child-"));
  const paths = resolveBrainPaths({ OTTO_HOME: root });
  const script = path.join(root, "fixture.mjs");
  fs.writeFileSync(
    script,
    `
    import http from 'node:http';
    const args = process.argv.slice(2);
    const mode = ${JSON.stringify(mode)};
    if (mode === 'exit') process.exit(23);
    const port = Number(args[args.indexOf('--port') + 1]);
    const server = http.createServer((req, res) => {
      if (req.url === '/health') { res.writeHead(mode === 'loading' ? 503 : 200); res.end('{}'); }
      else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ args, path: process.env.PATH })); }
    });
    server.listen(port, '127.0.0.1');
    if (mode === 'crash') process.on('message', () => process.exit(24));
  `,
  );
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("fixture port not bound");
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const model: Model = {
    id: "fixture/model/test-Q4_K_M.gguf",
    displayName: "Fixture model",
    modelPath: path.join(root, "test.gguf"),
    mmprojPath: null,
    mmprojBytes: 0,
    quant: "Q4_K_M",
    sizeBytes: 24,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: { contextLength: 2048 },
  };
  const runtime: Runtime = {
    label: "Fixture llama.cpp",
    version: "b10265",
    exe: process.execPath,
    dir: root,
    vendorDir: null,
    source: "managed",
  };
  const supervisor = new Supervisor({
    runtime,
    paths,
    internalPort: address.port,
    readyTimeoutMs: timeout,
    getProfilesStore: () => ProfilesStoreSchema.parse({}),
    driver: {
      ...llamaCppRuntimeDriver,
      createLaunch(input) {
        const launch = llamaCppRuntimeDriver.createLaunch(input);
        return { ...launch, args: [script, ...launch.args] };
      },
    },
  });
  fixtures.push({ root, supervisor });
  return { root, paths, model, runtime, supervisor, profile: defaultProfile(model) };
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

it("launches the concrete llama argument/env path, reads properties and joins host lifetime", async () => {
  const { root, model, profile, supervisor } = await fixture();
  const host = await startService({
    config: BrainConfigSchema.parse({ listen: { host: "127.0.0.1", port: 0 } }),
    env: { OTTO_HOME: root },
    runtime: supervisor,
  });
  let pid = 0;
  try {
    await supervisor.start(model, profile);
    pid = supervisor.status().pid!;
    const props = (await supervisor.properties()) as { args: string[]; path: string };
    expect(props.args).toContain(model.modelPath);
    expect(props.args).toContain("--reasoning-budget");
    expect(props.args).toContain("--slot-save-path");
    expect(props.path.startsWith(root + path.delimiter)).toBe(true);
    const base = `http://127.0.0.1:${host.port}`;
    expect(await (await fetch(base + "/__host/status")).json()).toMatchObject({
      state: "ready",
      modelId: model.id,
    });
    expect(await (await fetch(base + "/v1/models")).json()).toMatchObject({
      data: [{ id: model.id }],
    });
    await expect(supervisor.start(model, profile)).rejects.toThrow("already owned");
  } finally {
    await host.stop();
  }
  expect(alive(pid)).toBe(false);
  expect(supervisor.state).toBe("stopped");
});

it("terminates a loading child on readiness timeout", async () => {
  const { supervisor, model, profile } = await fixture("loading", 600);
  const starting = supervisor.start(model, profile);
  await expect.poll(() => supervisor.status().pid).not.toBeNull();
  const pid = supervisor.status().pid!;
  await expect(starting).rejects.toThrow();
  expect(supervisor.state).toBe("failed");
  expect(alive(pid)).toBe(false);
});

it("cancels loading without leaving a child or a failed resident identity", async () => {
  const { supervisor, model, profile } = await fixture("loading");
  const controller = new AbortController();
  const starting = supervisor.start(model, profile, controller.signal);
  await expect.poll(() => supervisor.status().pid).not.toBeNull();
  const pid = supervisor.status().pid!;
  controller.abort(new Error("fixture cancellation"));
  await expect(starting).rejects.toThrow("fixture cancellation");
  expect(supervisor.state).toBe("stopped");
  expect(alive(pid)).toBe(false);
});

it("reports an early native exit immediately and allows a later explicit attempt", async () => {
  const { supervisor, model, profile } = await fixture("exit");
  await expect(supervisor.start(model, profile)).rejects.toThrow("code 23");
  expect(supervisor.state).toBe("failed");
  expect(supervisor.status().pid).toBeNull();
  await expect(supervisor.start(model, profile)).rejects.toThrow("code 23");
});

it("reports a launch error without waiting for the readiness deadline", async () => {
  const { supervisor, runtime, model, profile, root } = await fixture();
  runtime.exe = path.join(root, "missing-executable");
  await expect(supervisor.start(model, profile)).rejects.toThrow("could not launch llama-server");
  expect(supervisor.status().pid).toBeNull();
});

it("marks an unexpected resident exit failed and reaps it before restart", async () => {
  const { supervisor, model, profile } = await fixture();
  await supervisor.start(model, profile);
  const pid = supervisor.status().pid!;
  const crashed = once(supervisor, "crashed");
  process.kill(pid, "SIGKILL");
  await crashed;
  expect(supervisor.state).toBe("failed");
  await supervisor.stop();
  expect(alive(pid)).toBe(false);
  await supervisor.start(model, profile);
  expect(supervisor.state).toBe("ready");
});

it("host shutdown interrupts readiness and repeated stop calls share completion", async () => {
  const { supervisor, model, profile, root } = await fixture("loading");
  const host = await startService({
    config: BrainConfigSchema.parse({ listen: { host: "127.0.0.1", port: 0 } }),
    env: { OTTO_HOME: root },
    runtime: supervisor,
  });
  const starting = supervisor.start(model, profile);
  const rejected = expect(starting).rejects.toThrow("Brain model stopped");
  await expect.poll(() => supervisor.status().pid).not.toBeNull();
  const pid = supervisor.status().pid!;
  try {
    await Promise.all([host.stop(), host.stop(), rejected]);
  } finally {
    await host.stop();
  }
  expect(alive(pid)).toBe(false);
  expect(supervisor.state).toBe("stopped");
});

it("refuses an occupied private port instead of accepting another server's health", async () => {
  const { supervisor, model, profile } = await fixture();
  const occupied = net.createServer();
  await new Promise<void>((resolve) =>
    occupied.listen(supervisor.internalPort, "127.0.0.1", resolve),
  );
  try {
    await expect(supervisor.start(model, profile)).rejects.toThrow("EADDRINUSE");
    expect(supervisor.status().pid).toBeNull();
    expect(supervisor.state).toBe("failed");
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});

it("stopping before child creation cancels the launch transaction", async () => {
  const { supervisor, model, profile } = await fixture();
  const starting = supervisor.start(model, profile);
  const rejected = expect(starting).rejects.toThrow("Brain model stopped");
  await supervisor.stop();
  await rejected;
  expect(supervisor.state).toBe("stopped");
  expect(supervisor.status().pid).toBeNull();
});
