/** Foreground composition only: fake listeners/runtime, no server or child process is launched. */
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { StartServiceOptions } from "../service/serve.js";
import { fixtureRoot } from "../../test-fixtures.js";
import { resolveBrainPaths } from "../config/paths.js";
import { readBrainConfigRevision, updateBrainConfig } from "../config/revision-store.js";
import { withBrainLocalEnvironment } from "./target.js";
const ports = vi.hoisted(() => ({
  start: vi.fn(),
  engine: vi.fn(),
  preload: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("../service/serve.js", () => ({ startService: ports.start }));
vi.mock("../service/engine.js", () => ({ createHostRuntime: ports.engine }));
import { runServeCommand } from "./lifecycle.js";

const roots: string[] = [];
const handlers: NodeJS.SignalsListener[] = [];
afterEach(() => {
  for (const handler of handlers.splice(0)) {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    const relative = path.relative(fixtureRoot(), root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected fixture cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
  ports.start.mockReset();
  ports.engine.mockReset();
  ports.preload.mockReset();
  ports.stop.mockReset();
});
function fixture() {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-foreground-"));
  roots.push(root);
  const env = { OTTO_HOME: root, PASEO_HOME: root };
  const paths = resolveBrainPaths(env);
  updateBrainConfig(
    readBrainConfigRevision(paths).revision,
    (config) => ({ ...config, defaultModel: "saved-but-not-requested" }),
    paths,
  );
  vi.stubEnv("OTTO_HOME", path.join(root, "ambient"));
  vi.stubEnv("PASEO_HOME", path.join(root, "ambient"));
  return { root, env };
}
it("passes the captured home to foreground configuration and runtime while leaving a saved default unloaded", async () => {
  const f = fixture();
  const before = new Set(process.listeners("SIGINT"));
  ports.stop.mockResolvedValue(undefined);
  ports.engine.mockReturnValue({ pool: { preload: ports.preload } });
  ports.start.mockImplementation(async (options: StartServiceOptions) => {
    if (!options.env || !options.createRuntime)
      throw new Error("Missing foreground owner environment");
    await options.createRuntime({
      config: options.config,
      env: options.env,
      paths: resolveBrainPaths(options.env),
      instanceId: "fixture",
    });
    return { host: "fixture", displayHost: "fixture", port: 1234, secure: false, stop: ports.stop };
  });
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  await withBrainLocalEnvironment(f.env, () => runServeCommand({}));
  const owned = process.listeners("SIGINT").filter((handler) => !before.has(handler));
  handlers.push(...owned);
  expect(ports.start).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      env: f.env,
      config: expect.objectContaining({ defaultModel: "saved-but-not-requested" }),
    }),
  );
  expect(ports.engine).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ env: f.env }));
  expect(ports.preload).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(f.root, "ambient"))).toBe(false);
  expect(owned).toHaveLength(1);
  owned[0]!("SIGINT");
  await vi.waitFor(() => expect(ports.stop).toHaveBeenCalledOnce());
});
it("releases only its signal handlers when foreground ownership fails before startup", async () => {
  const f = fixture();
  const beforeInt = process.listeners("SIGINT");
  const beforeTerm = process.listeners("SIGTERM");
  const failure = new Error("Fixture ownership conflict");
  ports.start.mockRejectedValue(failure);
  await expect(withBrainLocalEnvironment(f.env, () => runServeCommand({}))).rejects.toBe(failure);
  expect(process.listeners("SIGINT")).toEqual(beforeInt);
  expect(process.listeners("SIGTERM")).toEqual(beforeTerm);
  expect(ports.engine).not.toHaveBeenCalled();
});
