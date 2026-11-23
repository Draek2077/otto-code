import { mkdir, mkdtemp, realpath, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import {
  readContextAgents,
  readContextReport,
  readContextPreview,
  changeContextEdge,
} from "@getpaseo/plugin/otto/context-management";
import { InstructionSource } from "@getpaseo/plugin/server/otto-openai";
import { ContextManagementService } from "./host.js";
import type { ContextAgent } from "./agents.js";
const temporary = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const fixtures: string[] = [];
async function fixture() {
  await mkdir(temporary, { recursive: true });
  const directory = await mkdtemp(path.join(temporary, "context-host-"));
  fixtures.push(directory);
  const home = path.join(directory, "home"),
    root = path.join(directory, "project");
  await mkdir(home);
  await mkdir(root);
  await writeFile(path.join(root, ".git"), "fixture");
  await writeFile(path.join(root, "AGENTS.md"), "ROOT\n@rules.md\n[Available](optional.md)");
  await writeFile(path.join(root, "rules.md"), "IMPORTED");
  await writeFile(path.join(root, "optional.md"), "ON_DEMAND_ONLY");
  const physical = await realpath(root);
  const agents: ContextAgent[] = [];
  const invoke = vi.fn<(_plugin: string, _method: string, _input: unknown) => Promise<unknown>>();
  const owner = vi.fn<(_provider: string) => string | undefined>(() => undefined);
  const host = new ContextManagementService({
    hostId: "host",
    home,
    workspaces: {
      get: async (id) =>
        id === "workspace" ? { workspaceId: id, cwd: physical, archivedAt: null } : null,
    },
    agents: { list: () => agents, get: (id) => agents.find((agent) => agent.id === id) ?? null },
    providerOwner: owner,
    invoke,
  });
  return {
    host,
    root: physical,
    home,
    agents,
    invoke,
    owner,
    selection: { hostId: "host", workspaceId: "workspace", agentId: null, windowTokens: 16384 },
  };
}
afterEach(async () => {
  for (const directory of fixtures.splice(0)) {
    if (!directory.startsWith(temporary)) throw new Error("Fixture boundary");
    await rm(directory, { recursive: true, force: true });
  }
});

test("prospective report and source preview share the runtime resolver and disclose unknown inputs", async () => {
  const f = await fixture();
  const result = readContextReport.output.parse(
    await f.host.invoke(readContextReport.name, f.selection),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error("Report failed");
  expect(result.value.categories).toHaveLength(6);
  expect(result.value.categories.find((row) => row.category === "skills_roster")).toMatchObject({
    visibility: "not_visible",
    estimatedTokens: null,
  });
  expect(result.value.preparedRequest).toBeNull();
  expect(f.invoke).not.toHaveBeenCalled();
  const source = await InstructionSource.create({ cwd: f.root, home: f.home });
  const preview = readContextPreview.output.parse(
    await f.host.invoke(readContextPreview.name, {
      ...f.selection,
      revision: result.value.revision,
      category: "context_files",
      nodeId: null,
    }),
  );
  expect(preview.ok).toBe(true);
  if (!preview.ok) throw Error("Preview failed");
  expect(preview.value.text).toBe((await source.inspect()).text);
  expect(preview.value.text).not.toContain("ON_DEMAND_ONLY");
});
test("live named provider inspection uses the registered owner, not a provider-id guess", async () => {
  const f = await fixture();
  f.agents.push({
    id: "chat",
    provider: "preserved-local-model",
    workspaceId: "workspace",
    title: "Work",
    sessionId: "provider-session",
    internal: false,
  });
  f.owner.mockReturnValue("provider-with-context-inspection");
  const source = await InstructionSource.create({ cwd: f.root, home: f.home });
  const inspected = await source.inspect();
  const system = "DAEMON_CATALOG\n\n" + inspected.text;
  f.invoke.mockResolvedValue({
    ok: true,
    value: {
      capturedAt: "2026-10-25T12:00:00Z",
      phase: "completed",
      system,
      instructionText: inspected.text,
      tools: '[{"name":"fixture"}]',
      blocks: inspected.blocks,
    },
  });
  const result = readContextReport.output.parse(
    await f.host.invoke(readContextReport.name, { ...f.selection, agentId: "chat" }),
  );
  if (!result.ok) throw Error(result.error.message);
  expect(f.invoke).toHaveBeenCalledWith(
    "provider-with-context-inspection",
    "context.provider.inspect.request",
    {
      providerId: "preserved-local-model",
      sessionId: "provider-session",
    },
  );
  expect(result.value.preparedRequest?.phase).toBe("completed");
  expect(result.value.fixedTokens).toBe(
    result.value.categories.reduce((sum, row) => sum + (row.estimatedTokens ?? 0), 0),
  );
  const preview = readContextPreview.output.parse(
    await f.host.invoke(readContextPreview.name, {
      ...f.selection,
      agentId: "chat",
      revision: result.value.revision,
      category: "system_prompt",
      nodeId: null,
    }),
  );
  if (!preview.ok) throw Error(preview.error.message);
  expect(preview.value.text).toBe("DAEMON_CATALOG\n\n");
  expect(
    result.value.categories.find((row) => row.category === "otto_injected")?.estimatedTokens,
  ).toBeNull();
});
test("opaque providers stay visible as unknown and are never launched or measured as zero", async () => {
  const f = await fixture();
  f.agents.push({
    id: "chat",
    provider: "opaque-cli",
    workspaceId: "workspace",
    title: "Native",
    sessionId: "native",
    internal: false,
  });
  const result = readContextReport.output.parse(
    await f.host.invoke(readContextReport.name, { ...f.selection, agentId: "chat" }),
  );
  if (!result.ok) throw Error(result.error.message);
  expect(
    result.value.categories.every(
      (row) => row.visibility === "not_visible" && row.estimatedTokens === null,
    ),
  ).toBe(true);
  expect(f.invoke).not.toHaveBeenCalled();
});
test("wrong-host, missing and foreign-chat requests never reach provider inspection", async () => {
  const f = await fixture();
  f.agents.push({
    id: "foreign",
    provider: "openai-compatible",
    workspaceId: "another",
    title: null,
    sessionId: "provider",
    internal: false,
  });
  for (const selection of [
    { ...f.selection, hostId: "other" },
    { ...f.selection, workspaceId: "missing" },
    { ...f.selection, agentId: "foreign" },
  ])
    expect(await f.host.invoke(readContextReport.name, selection)).toMatchObject({ ok: false });
  expect(f.invoke).not.toHaveBeenCalled();
});
test("agent picker exposes only non-internal chats in the selected workspace", async () => {
  const f = await fixture();
  const base = { provider: "native", title: "Work", sessionId: null, internal: false };
  f.agents.push(
    { ...base, id: "own", workspaceId: "workspace" },
    { ...base, id: "foreign", workspaceId: "other" },
    { ...base, id: "internal", workspaceId: "workspace", internal: true },
  );
  expect(await f.host.invoke(readContextAgents.name, f.selection)).toMatchObject({
    ok: false,
    error: { code: "invalid" },
  });
  expect(
    await f.host.invoke(readContextAgents.name, { hostId: "host", workspaceId: "workspace" }),
  ).toEqual({ ok: true, value: [{ id: "own", label: "Work", provider: "native" }] });
});
test("reviewed load-mode mutation changes the real next request without copying linked bodies", async () => {
  const f = await fixture();
  const report = readContextReport.output.parse(
    await f.host.invoke(readContextReport.name, f.selection),
  );
  if (!report.ok) throw Error(report.error.message);
  const edge = report.value.edges.find((value) => value.kind === "import")!;
  expect(
    await f.host.invoke(changeContextEdge.name, {
      ...f.selection,
      revision: report.value.revision,
      edgeId: edge.id,
      mode: "reference",
    }),
  ).toEqual({ ok: true, value: { changed: true } });
  const source = await InstructionSource.create({ cwd: f.root, home: f.home });
  expect(await source.forRequest()).not.toContain("IMPORTED");
  expect(await readFile(path.join(f.root, "rules.md"), "utf8")).toBe("IMPORTED");
  expect(
    await f.host.invoke(changeContextEdge.name, {
      ...f.selection,
      revision: report.value.revision,
      edgeId: edge.id,
      mode: "reference",
    }),
  ).toMatchObject({ ok: false, error: { code: "conflict" } });
});
test("external source changes invalidate preview and refuse stale writes", async () => {
  const f = await fixture();
  const report = readContextReport.output.parse(
    await f.host.invoke(readContextReport.name, f.selection),
  );
  if (!report.ok) throw Error(report.error.message);
  await writeFile(path.join(f.root, "rules.md"), "PEER_CHANGE");
  expect(
    await f.host.invoke(readContextPreview.name, {
      ...f.selection,
      revision: report.value.revision,
      category: "context_files",
      nodeId: null,
    }),
  ).toMatchObject({ ok: false, error: { code: "conflict" } });
});

test("external referenced-body changes invalidate on-demand previews without adding fixed weight", async () => {
  const f = await fixture();
  const before = readContextReport.output.parse(
    await f.host.invoke(readContextReport.name, f.selection),
  );
  if (!before.ok) throw Error(before.error.message);
  await writeFile(path.join(f.root, "optional.md"), "UPDATED_REFERENCE_BODY");
  const after = readContextReport.output.parse(
    await f.host.invoke(readContextReport.name, f.selection),
  );
  if (!after.ok) throw Error(after.error.message);
  expect(after.value.revision).not.toBe(before.value.revision);
  expect(after.value.fixedTokens).toBe(before.value.fixedTokens);
  const node = after.value.nodes.find((value) => value.label === "optional.md")!;
  const preview = readContextPreview.output.parse(
    await f.host.invoke(readContextPreview.name, {
      ...f.selection,
      revision: after.value.revision,
      nodeId: node.id,
      category: null,
    }),
  );
  if (!preview.ok) throw Error(preview.error.message);
  expect(preview.value.text).toBe("UPDATED_REFERENCE_BODY");
});
