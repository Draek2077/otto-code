import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { BrainConfigSchema } from "./config/schema.js";
import { resolveBrainPaths } from "./config/paths.js";
import { saveBrainConfig } from "./config/store.js";

const roots: string[] = [];
const children: ChildProcess[] = [];
const entry = fileURLToPath(new URL("../bin/otto-brain", import.meta.url));
async function launch(home: string): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(process.execPath, [entry, "serve"], {
    env: { ...process.env, OTTO_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("fixture host did not become ready")), 5000);
    let output = "";
    const failed = () => {
      clearTimeout(timeout);
      reject(new Error("fixture host exited before readiness"));
    };
    child.once("exit", failed);
    child.once("error", failed);
    child.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
      const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timeout);
        child.off("exit", failed);
        child.off("error", failed);
        resolve(Number(match[1]));
      }
    });
  });
  return { child, port };
}
async function killFixture(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}
afterEach(async () => {
  for (const child of children.splice(0)) await killFixture(child);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("recovers an abruptly exited standalone host in its existing isolated home", async () => {
  const scratch = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const home = mkdtempSync(path.join(scratch, "brain-lifecycle-"));
  roots.push(home);
  const paths = resolveBrainPaths({ OTTO_HOME: home });
  saveBrainConfig(
    BrainConfigSchema.parse({
      listen: { port: 0 },
      autoStart: true,
      defaultModel: "preserved-unloaded-model",
    }),
    paths,
  );
  const original = readFileSync(paths.configFile, "utf8");
  const first = await launch(home);
  expect((await fetch(`http://127.0.0.1:${first.port}/health`)).status).toBe(200);
  await killFixture(first.child);
  const second = await launch(home);
  expect((await fetch(`http://127.0.0.1:${second.port}/health`)).status).toBe(200);
  expect(await (await fetch(`http://127.0.0.1:${second.port}/__host/status`)).json()).toEqual({
    state: "stopped",
    model: null,
    modelId: null,
  });
  expect(readFileSync(paths.configFile, "utf8")).toBe(original);
}, 15000);
