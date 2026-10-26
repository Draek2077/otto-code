import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PreviewManager, type PreviewProcess } from "./manager.js";
import { previewCommandRevision, readPreviewLaunchConfig } from "./launch-config.js";
import { PreviewLogs } from "./logs.js";

const roots: string[] = [];
const managers: PreviewManager[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.close().catch(() => {});
  vi.useRealTimers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const entry = { name: "web", runtimeExecutable: "npm", runtimeArgs: ["run", "dev"], port: 8200 };
async function fixture(port = 8200) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "otto-preview-manager-"));
  roots.push(cwd);
  await mkdir(path.join(cwd, ".claude"));
  const file = path.join(cwd, ".claude", "launch.json");
  const configEntry = { ...entry, port };
  await writeFile(file, JSON.stringify({ configurations: [configEntry] }));
  const config = await readPreviewLaunchConfig(cwd);
  if (!config) throw Error("Fixture configuration missing");
  const listening = new Set<number>();
  let rejectSpawn = false,
    rejectStop = false;
  let output: ((source: "stdout" | "stderr", text: string) => void) | undefined;
  const processes: Array<{
    resolve(value: { code: number | null; signal: string | null }): void;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const spawn = vi.fn(async (input: { output: typeof output }): Promise<PreviewProcess> => {
    if (rejectSpawn) throw Error("SECRET-SENSITIVE-SPAWN-ERROR");
    output = input.output;
    let resolveExit!: (value: { code: number | null; signal: string | null }) => void;
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      resolveExit = resolve;
    });
    const stop = vi.fn(async () => {
      if (rejectStop) throw Error("denied");
      listening.delete(port);
      resolveExit({ code: null, signal: "SIGTERM" });
    });
    processes.push({ resolve: resolveExit, stop });
    return { pid: processes.length + 100, exited, stop };
  });
  const manager = new PreviewManager({
    probe: async (candidate) => listening.has(candidate),
    spawn,
    protectedPorts: new Set([8999]),
  });
  managers.push(manager);
  const start = {
    cwd,
    name: "web",
    approvedCommandRevision: previewCommandRevision(config.cwd, configEntry),
  };
  return {
    cwd,
    file,
    listening,
    manager,
    start,
    spawn,
    processes,
    output: (source: "stdout" | "stderr", text: string) => output?.(source, text),
    rejectSpawn: () => {
      rejectSpawn = true;
    },
    rejectStop: () => {
      rejectStop = true;
    },
  };
}
test("concurrent starts reuse one process, expose pending status and become ready", async () => {
  const f = await fixture();
  vi.useFakeTimers();
  const [first, second] = await Promise.all([f.manager.start(f.start), f.manager.start(f.start)]);
  expect(first.server.status).toBe("starting");
  expect(first.reused).toBe(false);
  expect(second).toEqual({ server: first.server, reused: true });
  expect(f.spawn).toHaveBeenCalledTimes(1);
  f.listening.add(8200);
  await vi.advanceTimersByTimeAsync(250);
  expect((await f.manager.list(f.cwd))[0].status).toBe("ready");
  expect(first.server.status).toBe("starting"); // Caller snapshots are immutable projections.
});
test("list adopts configured listening servers, refreshes URL and never acquires stop authority", async () => {
  const f = await fixture();
  f.listening.add(8200);
  const [adopted] = await f.manager.list(f.cwd);
  expect(adopted).toMatchObject({ id: "ext:8200", managed: false, pid: null, status: "ready" });
  const result = await f.manager.start({
    ...f.start,
    approvedCommandRevision: "not-an-execution-approval",
  });
  expect(result.reused).toBe(true);
  expect(f.spawn).not.toHaveBeenCalled();
  await expect(f.manager.stop(f.cwd, adopted.id)).rejects.toThrow("did not start");
  await writeFile(
    f.file,
    JSON.stringify({ configurations: [{ ...entry, url: "https://preview.example/app" }] }),
  );
  expect((await f.manager.list(f.cwd))[0].url).toBe("https://preview.example/app");
  f.listening.clear();
  expect((await f.manager.list(f.cwd))[0].status).toBe("stopped");
});
test("command edits require approval of the exact current execution identity", async () => {
  const f = await fixture();
  await writeFile(
    f.file,
    JSON.stringify({ configurations: [{ ...entry, runtimeArgs: ["run", "other"] }] }),
  );
  await expect(f.manager.start(f.start)).rejects.toThrow("changed");
  expect(f.spawn).not.toHaveBeenCalled();
});
test.each([6868, 5432, 8999])("protected port %i is never launched", async (port) => {
  const f = await fixture(port);
  await expect(f.manager.start(f.start)).rejects.toThrow("protected");
  expect(f.spawn).not.toHaveBeenCalled();
});
test("readiness timeout keeps the process owned until an explicit confirmed stop", async () => {
  const f = await fixture();
  vi.useFakeTimers();
  const result = await f.manager.start(f.start);
  await vi.advanceTimersByTimeAsync(60000);
  f.listening.add(8200);
  expect(await f.manager.list(f.cwd)).toHaveLength(1); // A late listener is still our failed process, never a second external server.
  expect((await f.manager.list(f.cwd))[0]).toMatchObject({
    status: "error",
    error: expect.stringContaining("60 seconds"),
  });
  await expect(f.manager.start(f.start)).rejects.toThrow("Stop the previous");
  expect(f.spawn).toHaveBeenCalledTimes(1);
  expect((await f.manager.stop(f.cwd, result.server.id)).status).toBe("stopped");
  expect(f.processes[0].stop).toHaveBeenCalledTimes(1);
  expect((await f.manager.start(f.start)).reused).toBe(false);
});
test("a failed stop remains visible and blocks duplicate launches", async () => {
  const f = await fixture();
  const result = await f.manager.start(f.start);
  f.rejectStop();
  await expect(f.manager.stop(f.cwd, result.server.id)).rejects.toThrow("Could not confirm");
  await expect(f.manager.start(f.start)).rejects.toThrow("may still be running");
  expect(f.spawn).toHaveBeenCalledTimes(1);
});
test("spawn and exit errors remain visible without leaking spawn exception text", async () => {
  const f = await fixture();
  f.rejectSpawn();
  await expect(f.manager.start(f.start)).rejects.toThrow("Could not start");
  expect((await f.manager.list(f.cwd))[0].error).not.toContain("SECRET");
  const other = await fixture();
  const result = await other.manager.start(other.start);
  other.output("stderr", "final failure");
  other.processes[0].resolve({ code: 1, signal: null });
  await Promise.resolve();
  expect((await other.manager.list(other.cwd))[0].error).toContain("exited (1)");
  expect((await other.manager.logs(other.cwd, result.server.id))[0].text).toBe("final failure");
});
test("server access and stop are scoped to the canonical caller directory", async () => {
  const f = await fixture(),
    other = await fixture();
  const result = await f.manager.start(f.start);
  await expect(f.manager.stop(other.cwd, result.server.id)).rejects.toThrow("does not belong");
  await expect(f.manager.logs(other.cwd, result.server.id)).rejects.toThrow("does not belong");
  await f.manager.bindBrowser(f.cwd, result.server.id, "returned-browser-id");
  expect((await f.manager.list(f.cwd))[0].browserId).toBe("returned-browser-id");
});
test("a naturally exited command still requires stop before another process is admitted", async () => {
  const f = await fixture();
  const result = await f.manager.start(f.start);
  f.processes[0].resolve({ code: 0, signal: null });
  await Promise.resolve();
  await expect(f.manager.start(f.start)).rejects.toThrow("Stop the previous");
  expect(f.spawn).toHaveBeenCalledTimes(1);
  await f.manager.stop(f.cwd, result.server.id);
  expect((await f.manager.start(f.start)).reused).toBe(false);
});
test("log retention, partial chunks, filters and returned copies remain bounded", () => {
  const logs = new PreviewLogs();
  logs.append("stdout", "partial");
  logs.append("stdout", " line\n");
  expect(logs.read()).toEqual([{ sequence: 1, source: "stdout", text: "partial line" }]);
  for (let index = 0; index < 2100; index++)
    logs.append("stderr", `${index}: ERROR ${"x".repeat(1500)}\n`);
  const rows = logs.read({ lines: 5000 });
  expect(rows.length).toBeLessThan(2000);
  expect(Buffer.byteLength(JSON.stringify(rows))).toBeLessThan(128 * 1024 + 2000);
  expect(rows[0].text.length).toBe(1000);
  expect(logs.read({ level: "error", search: "2099", lines: 1 })[0].text).toContain("2099: ERROR");
  rows[0].text = "modified";
  expect(logs.read({ lines: 2000 })[0].text).not.toBe("modified");
});
