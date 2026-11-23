import { expect, test, vi } from "vitest";
import { createPreviewTools } from "./tools.js";
import { retainedToolEnabled } from "../retained-tool-policy.js";
function fixture(enabled = true, bound = true) {
  const server = {
    id: "owned",
    name: "web",
    cwd: "/fixture",
    port: 8200,
    url: "http://127.0.0.1:8200",
    managed: true,
    status: "ready" as const,
    pid: 123,
    error: null,
    browserId: null,
  };
  const host = {
    list: vi.fn(async () => ({
      configured: false,
      configError: null,
      revision: null,
      cwd: "/fixture",
      commands: [],
      servers: [],
    })),
    start: vi.fn(async () => ({ server, reused: true, browserError: null })),
    stop: vi.fn(async () => server),
    logs: vi.fn(async () => []),
  };
  const binding = { cwd: "/fixture", workspaceId: "workspace", agentId: "agent" };
  const policy = vi.fn(async () => enabled);
  const tools = createPreviewTools({
    host,
    policy,
    caller: () => ({ binding: bound ? binding : null, provider: "local" }),
  });
  return {
    host,
    binding,
    policy,
    run: (name: string, input: unknown) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error("Missing tool");
      return tool.handler(input, {});
    },
  };
}
test("list and logs resolve only the live owning chat; registration has no effects", async () => {
  const f = fixture();
  expect(f.host.list).not.toHaveBeenCalled();
  expect((await f.run("preview_list", {})).isError).toBeUndefined();
  expect(f.host.list).toHaveBeenCalledWith(f.binding);
  await f.run("preview_logs", { serverId: "owned", lines: 20, search: "error" });
  expect(f.host.logs).toHaveBeenCalledWith(f.binding, "owned", {
    serverId: "owned",
    lines: 20,
    search: "error",
  });
});
test.each(["preview_start", "preview_stop"])(
  "%s rejects missing scope and unreadable/disabled policy before effects",
  async (name) => {
    const input =
      name === "preview_start"
        ? { name: "web", commandRevision: "a".repeat(64) }
        : { serverId: "owned" };
    for (const f of [fixture(false), fixture(true, false)]) {
      expect((await f.run(name, input)).isError).toBe(true);
      expect(f.host.start).not.toHaveBeenCalled();
      expect(f.host.stop).not.toHaveBeenCalled();
    }
  },
);
test("start forwards the reviewed command pin; stop forwards only the server identity", async () => {
  const f = fixture(),
    revision = "a".repeat(64);
  await f.run("preview_start", { name: "web", commandRevision: revision });
  expect(f.host.start).toHaveBeenCalledWith(f.binding, "web", revision);
  await f.run("preview_stop", { serverId: "owned" });
  expect(f.host.stop).toHaveBeenCalledWith(f.binding, "owned");
});
test.each([{ cwd: "/elsewhere" }, { workspaceId: "other" }, { hostId: "other" }])(
  "never accepts model supplied scope $cwd$workspaceId$hostId",
  async (input) => {
    const f = fixture();
    expect((await f.run("preview_list", input)).isError).toBe(true);
    expect(f.host.list).not.toHaveBeenCalled();
  },
);
test("host failures never return execution environment or filesystem error text", async () => {
  const f = fixture();
  f.host.list.mockRejectedValueOnce(new Error("PRIVATE_KEY=secret"));
  const result = await f.run("preview_list", {});
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_KEY");
});
test("tool output refuses an oversized result instead of flooding the model", async () => {
  const f = fixture();
  f.host.list.mockResolvedValueOnce({
    configured: false,
    configError: null,
    revision: null,
    cwd: "x".repeat(200 * 1024),
    commands: [],
    servers: [],
  });
  const result = await f.run("preview_list", {});
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).toContain("tool budget");
  expect(JSON.stringify(result).length).toBeLessThan(1024);
});
test("Preview and Kanban retain independent group ceilings and exact provider restrictions", () => {
  const config = {
    mcp: { toolGroupsV2: ["kanban", "preview"] },
    providers: {
      local: { ottoToolGroupsV2: ["preview"], ottoTools: { disabledTools: ["preview_stop"] } },
    },
  };
  expect(retainedToolEnabled("preview", config, "preview_start", "local")).toBe(true);
  expect(retainedToolEnabled("preview", config, "preview_stop", "local")).toBe(false);
  expect(retainedToolEnabled("kanban", config, "kanban_get_board", "local")).toBe(false);
  expect(
    retainedToolEnabled("preview", { mcp: { toolGroupsV2: [] } }, "preview_start", "local"),
  ).toBe(false);
});
