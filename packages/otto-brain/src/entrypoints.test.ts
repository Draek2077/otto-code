import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const roots: string[] = [];
function environment() {
  mkdirSync(fileURLToPath(new URL("../../../.tmp/", import.meta.url)), { recursive: true });
  const root = mkdtempSync(fileURLToPath(new URL("../../../.tmp/brain-entry-", import.meta.url)));
  roots.push(root);
  const home = path.join(root, "untouched-home");
  return { home, env: { ...process.env, OTTO_HOME: home } };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("imports public built entry points without touching a home or starting a host", () => {
  const { home, env } = environment();
  const urls = [
    "index",
    "config/index",
    "runtime/index",
    "models/index",
    "service/serve",
    "service/supervisor",
    "ops/index",
    "cli",
    "cli-target",
    "host",
  ].map((name) => pathToFileURL(path.join(packageRoot, `dist/${name}.js`)).href);
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `for (const url of ${JSON.stringify(urls)}) await import(url);`],
    { env, encoding: "utf8", timeout: 5000, windowsHide: true },
  );
  expect(child.stderr).toBe("");
  expect(child.status).toBe(0);
  expect(existsSync(home)).toBe(false);
});

it("standalone help succeeds without reading or creating user configuration", () => {
  const { home, env } = environment();
  const child = spawnSync(process.execPath, [path.join(packageRoot, "bin/otto-brain"), "--help"], {
    env,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  expect(child.stderr).toBe("");
  expect(child.status).toBe(0);
  expect(child.stdout).toContain("Otto Brain standalone host");
  for (const command of [
    "serve",
    "start",
    "stop",
    "restart",
    "status",
    "calibrate",
    "sweep",
    "scan",
    "catalog",
    "search",
    "pull",
    "add",
    "runtime",
    "bench",
    "share",
    "report",
    "rescore",
    "config",
  ])
    expect(child.stdout).toContain(command);
  expect(existsSync(home)).toBe(false);
});

it("registers the shared command tree without evaluating model, host or benchmark implementations", () => {
  const { home, env } = environment();
  const loader = `export async function resolve(specifier, context, next) {
    const result = await next(specifier, context);
    if (/\\/(?:service|models|ops|bench)\\//.test(result.url))
      throw new Error('Command registration evaluated an operation: ' + result.url);
    return result;
  }`;
  const cli = pathToFileURL(path.join(packageRoot, "dist/cli.js")).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { register } from 'node:module';
    register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(loader)}`)});
    const { createBrainCommand } = await import(${JSON.stringify(cli)});
    const command = createBrainCommand();
    process.stdout.write(command.helpInformation());
    process.stdout.write(command.commands.find(item => item.name() === 'runtime').helpInformation());
  `,
    ],
    { env, encoding: "utf8", timeout: 5000, windowsHide: true },
  );
  expect(child.stderr).toBe("");
  expect(child.status).toBe(0);
  expect(child.stdout).toContain("rescore");
  expect(child.stdout).toContain("--quiet");
  expect(child.stdout).toContain("install");
  expect(existsSync(home)).toBe(false);
});

it("calibration and sweep help are inert even without a runtime or saved configuration", () => {
  const { home, env } = environment();
  for (const command of ["calibrate", "sweep"]) {
    const child = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin/otto-brain"), command, "--help"],
      { env, encoding: "utf8", timeout: 5000, windowsHide: true },
    );
    expect(child.status).toBe(0);
    expect(child.stderr).toBe("");
    expect(child.stdout).toContain("--model");
  }
  expect(existsSync(home)).toBe(false);
});

it("acquisition help does not create a host, resolve credentials or inspect an installed runtime", () => {
  const { home, env } = environment();
  for (const args of [
    ["pull"],
    ["add"],
    ["runtime", "install"],
    ["bench"],
    ["share"],
    ["report"],
    ["rescore"],
  ]) {
    const child = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin/otto-brain"), ...args, "--help"],
      { env, encoding: "utf8", timeout: 5000, windowsHide: true },
    );
    expect(child.status).toBe(0);
    expect(child.stderr).toBe("");
    expect(child.stdout).toContain("Options:");
  }
  expect(existsSync(home)).toBe(false);
});
