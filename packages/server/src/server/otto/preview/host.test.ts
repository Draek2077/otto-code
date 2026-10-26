import { afterEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readPreviewConfig,
  startPreviewServer,
  stopPreviewServer,
  openPreviewBrowser,
} from "@getpaseo/plugin/otto/preview";
import { PreviewHost } from "./host.js";
import { PreviewManager } from "./manager.js";
import type { BrowserToolsExecuteInput } from "../../browser-tools/broker.js";
import type { BrowserToolsResponsePayload } from "../../browser-tools/errors.js";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});
async function fixture() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "otto-preview-host-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, ".claude"));
  await writeFile(
    path.join(cwd, ".claude", "launch.json"),
    JSON.stringify({
      configurations: [
        {
          name: "web",
          port: 8200,
          runtimeExecutable: "npm",
          runtimeArgs: ["run", "dev"],
          env: { PRIVATE_KEY: "NEVER_RETURN_THIS_SECRET" },
        },
      ],
    }),
  );
  const spawn = vi.fn(async () => {
    let finish!: (value: { code: number | null; signal: string | null }) => void;
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      finish = resolve;
    });
    return {
      pid: 12345,
      exited,
      stop: vi.fn(async () => {
        finish({ code: 0, signal: null });
      }),
    };
  });
  const manager = new PreviewManager({
    probe: async () => false,
    spawn,
    protectedPorts: new Set(),
  });
  cleanups.push(() => manager.close());
  let failedList = false;
  const tabs: Array<{
    browserId: string;
    workspaceId: string;
    url: string;
    title: string;
    isActive: boolean;
    isLoading: boolean;
  }> = [];
  const execute = vi.fn(
    async (input: BrowserToolsExecuteInput): Promise<BrowserToolsResponsePayload> => {
      if (input.command.command === "list_tabs") {
        if (failedList)
          return {
            requestId: "fixture",
            ok: false,
            error: { code: "browser_no_host", message: "Unavailable", retryable: true },
          };
        return {
          requestId: "fixture",
          ok: true,
          result: {
            command: "list_tabs",
            tabs: tabs.filter((tab) => tab.workspaceId === input.workspaceId),
          },
        };
      }
      if (input.command.command !== "new_tab" || !input.workspaceId)
        throw new Error("Unexpected fixture operation");
      const tab = {
        browserId: randomUUID(),
        workspaceId: input.workspaceId,
        url: input.command.args.url ?? "about:blank",
        title: "Fixture",
        isActive: false,
        isLoading: false,
      };
      tabs.push(tab);
      return {
        requestId: "fixture",
        ok: true,
        result: {
          command: "new_tab",
          browserId: tab.browserId,
          workspaceId: tab.workspaceId,
          url: tab.url,
        },
      };
    },
  );
  const host = new PreviewHost({
    hostId: "host",
    manager,
    broker: { execute },
    workspaces: {
      get: async (id) => (id === "workspace" || id === "second" ? { cwd, archivedAt: null } : null),
    },
  });
  const scope = { hostId: "host", workspaceId: "workspace" };
  const config = readPreviewConfig.output.parse(await host.invoke(readPreviewConfig.name, scope));
  if (!config.ok) throw new Error(config.error.message);
  const input = {
    ...scope,
    name: "web",
    commandRevision: config.value.commands[0].commandRevision,
    userApprovedStart: true as const,
  };
  return {
    host,
    manager,
    scope,
    input,
    cwd,
    file: path.join(cwd, ".claude", "launch.json"),
    spawn,
    tabs,
    execute,
    config: config.value,
    failList: (value: boolean) => {
      failedList = value;
    },
  };
}
test("Preview projection exposes a bounded execution digest without host environment secrets", async () => {
  const f = await fixture();
  expect(f.config).toMatchObject({
    configured: true,
    servers: [],
    commands: [{ name: "web", port: 8200, command: '"npm" "run" "dev"' }],
  });
  expect(f.config.commands[0].commandRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(f.config)).not.toContain("NEVER_RETURN_THIS_SECRET");
  expect(f.spawn).not.toHaveBeenCalled();
});
test("Preview app projection refuses oversized transport payloads without losing process ownership", async () => {
  const f = await fixture();
  const servers = Array.from({ length: 128 }, (_, index) => ({
    id: `owned-${index}`,
    name: "web",
    cwd: "x".repeat(8192),
    port: 8200,
    url: "http://127.0.0.1:8200",
    managed: true,
    status: "ready" as const,
    pid: 123,
    error: null,
    browserId: null,
  }));
  const read = vi.spyOn(f.manager, "list").mockResolvedValueOnce(servers);
  const result = await f.host.invoke(readPreviewConfig.name, f.scope);
  expect(result).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining("transport budget") },
  });
  expect(f.spawn).not.toHaveBeenCalled();
  read.mockRestore();
});
test("foreign hosts, missing workspaces and unapproved starts cannot launch", async () => {
  const f = await fixture();
  expect(
    await f.host.invoke(startPreviewServer.name, { ...f.input, hostId: "other" }),
  ).toMatchObject({ ok: false });
  expect(
    await f.host.invoke(startPreviewServer.name, { ...f.input, workspaceId: "missing" }),
  ).toMatchObject({ ok: false });
  expect(
    await f.host.invoke(startPreviewServer.name, { ...f.input, userApprovedStart: false }),
  ).toMatchObject({ ok: false, error: { code: "invalid" } });
  expect(
    await f.host.invoke(startPreviewServer.name, { ...f.input, commandRevision: "0".repeat(64) }),
  ).toMatchObject({ ok: false });
  expect(f.spawn).not.toHaveBeenCalled();
});
test("parallel starts reuse one process and one designated browser in the same workspace", async () => {
  const f = await fixture();
  const replies = await Promise.all([
    f.host.invoke(startPreviewServer.name, f.input),
    f.host.invoke(startPreviewServer.name, f.input),
  ]);
  const results = replies.map((reply) => startPreviewServer.output.parse(reply));
  expect(results.every((result) => result.ok)).toBe(true);
  expect(f.spawn).toHaveBeenCalledTimes(1);
  expect(f.tabs).toHaveLength(1);
  for (const result of results)
    if (result.ok) expect(result.value.server.browserId).toBe(f.tabs[0].browserId);
});
test("shared cwd servers retain distinct designated browsers for different workspace authorities", async () => {
  const f = await fixture();
  const first = startPreviewServer.output.parse(
    await f.host.invoke(startPreviewServer.name, f.input),
  );
  const second = startPreviewServer.output.parse(
    await f.host.invoke(startPreviewServer.name, { ...f.input, workspaceId: "second" }),
  );
  if (!first.ok || !second.ok) throw new Error("Fixture start failed");
  expect(first.value.server.id).toBe(second.value.server.id);
  expect(first.value.server.browserId).not.toBe(second.value.server.browserId);
  expect(f.spawn).toHaveBeenCalledTimes(1);
  expect(f.tabs).toHaveLength(2);
});
test("failed browser enumeration never authorizes another tab or loses the started process", async () => {
  const f = await fixture();
  f.failList(true);
  const first = startPreviewServer.output.parse(
    await f.host.invoke(startPreviewServer.name, f.input),
  );
  if (!first.ok) throw new Error("Process outcome was lost");
  expect(first.value.browserError).toContain("server is tracked");
  expect(first.value.server.status).toBe("starting");
  expect(f.tabs).toHaveLength(0);
  f.failList(false);
  const opened = openPreviewBrowser.output.parse(
    await f.host.invoke(openPreviewBrowser.name, { ...f.scope, serverId: first.value.server.id }),
  );
  expect(opened.ok).toBe(true);
  expect(f.tabs).toHaveLength(1);
  expect(f.spawn).toHaveBeenCalledTimes(1);
});
test("a confirmed close permits replacement, while repeated opens reuse the existing bound tab", async () => {
  const f = await fixture();
  const started = startPreviewServer.output.parse(
    await f.host.invoke(startPreviewServer.name, f.input),
  );
  if (!started.ok) throw new Error("Fixture start failed");
  const binding = { ...f.scope, serverId: started.value.server.id };
  const first = await f.host.invoke(openPreviewBrowser.name, binding);
  expect(await f.host.invoke(openPreviewBrowser.name, binding)).toEqual(first);
  expect(f.tabs).toHaveLength(1);
  f.tabs.splice(0);
  expect(await f.host.invoke(openPreviewBrowser.name, binding)).not.toEqual(first);
  expect(f.tabs).toHaveLength(1);
  expect(
    await f.host.invoke(stopPreviewServer.name, { ...binding, userApprovedStop: false }),
  ).toMatchObject({ ok: false });
  expect(
    await f.host.invoke(stopPreviewServer.name, { ...binding, userApprovedStop: true }),
  ).toMatchObject({ ok: true, value: { status: "stopped" } });
});
test("invalid configuration and a removed directory retain owned stop authority", async () => {
  const f = await fixture();
  const started = startPreviewServer.output.parse(
    await f.host.invoke(startPreviewServer.name, f.input),
  );
  if (!started.ok) throw new Error("Fixture start failed");
  await writeFile(f.file, "invalid launch fixture");
  const invalid = readPreviewConfig.output.parse(
    await f.host.invoke(readPreviewConfig.name, f.scope),
  );
  expect(invalid).toMatchObject({
    ok: true,
    value: {
      configError: expect.stringContaining("Invalid launch"),
      commands: [],
      servers: [{ id: started.value.server.id }],
    },
  });
  await rm(f.cwd, { recursive: true });
  const removed = readPreviewConfig.output.parse(
    await f.host.invoke(readPreviewConfig.name, f.scope),
  );
  expect(removed).toMatchObject({
    ok: true,
    value: { servers: [{ id: started.value.server.id }] },
  });
  expect(
    await f.host.invoke(stopPreviewServer.name, {
      ...f.scope,
      serverId: started.value.server.id,
      userApprovedStop: true,
    }),
  ).toMatchObject({ ok: true, value: { status: "stopped" } });
});
