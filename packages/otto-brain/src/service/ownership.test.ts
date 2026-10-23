import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { resolveBrainPaths } from "../config/paths.js";
import { acquireServiceOwnership } from "./ownership.js";
import { readPidFile, writePidFile } from "./pid-lock.js";

const roots: string[] = [];
function home() {
  const scratch = fileURLToPath(new URL("../../../../.tmp/", import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(path.join(scratch, "brain-owner-"));
  roots.push(root);
  return { OTTO_HOME: root };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("refuses a second owner of the same home, even before its listener is ready", () => {
  const env = home();
  const first = acquireServiceOwnership(env);
  expect(() => acquireServiceOwnership(env)).toThrow("already owned");
  first.release();
  const next = acquireServiceOwnership(env);
  next.release();
});

it("releases only its own pid record", () => {
  const env = home();
  const first = acquireServiceOwnership(env);
  writePidFile(
    {
      pid: process.pid,
      host: "127.0.0.1",
      port: 1234,
      startedAt: "fixture",
      instanceId: "replacement",
    },
    env,
  );
  first.release();
  expect(readPidFile(env)?.instanceId).toBe("replacement");
});

it("refuses a live legacy host without modifying its state", () => {
  const env = home();
  writePidFile({ pid: process.pid, host: "127.0.0.1", port: 1234, startedAt: "fixture" }, env);
  const file = resolveBrainPaths(env).pidFile;
  const before = readFileSync(file, "utf8");
  expect(() => acquireServiceOwnership(env)).toThrow("already running");
  expect(readFileSync(file, "utf8")).toBe(before);
});

it("fails closed on a malformed ownership record", () => {
  const env = home();
  const file = `${resolveBrainPaths(env).pidFile}.owner`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "broken");
  expect(() => acquireServiceOwnership(env)).toThrow("ownership record");
  expect(readFileSync(file, "utf8")).toBe("broken");
});

it("never treats process-group or invalid pids as a running Brain", () => {
  const env = home();
  const file = resolveBrainPaths(env).pidFile;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ pid: 0, host: "127.0.0.1", port: 1234, startedAt: "fixture" }),
  );
  expect(readPidFile(env)).toBe(null);
});

it("recovers an exited owner's claim without signaling any process", () => {
  const env = home();
  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  expect(child.status).toBe(0);
  const file = `${resolveBrainPaths(env).pidFile}.owner`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ pid: Number(child.stdout), instanceId: "exited-fixture" }));
  const ownership = acquireServiceOwnership(env);
  ownership.release();
});
