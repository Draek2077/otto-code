import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, realpath, writeFile, readFile, readdir, link, rm } from "node:fs/promises";
import { afterEach, expect, test } from "vitest";
import {
  readContextSourceFile,
  saveContextSourceFile,
  readContextPreview,
  readContextReport,
} from "@getpaseo/plugin/otto/context-management";
import { instructionDigest } from "@getpaseo/plugin/server/otto-openai";
import { ContextManagementService } from "./host.js";

const temporary = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const fixtures: string[] = [];
async function fixture(captured = false) {
  await mkdir(temporary, { recursive: true });
  const created = await mkdtemp(path.join(temporary, "context-source-"));
  fixtures.push(created);
  const directory = await realpath(created),
    root = path.join(directory, "project"),
    home = path.join(directory, "home");
  await mkdir(root);
  await mkdir(home);
  await writeFile(path.join(root, ".git"), "fixture");
  const file = path.join(root, "AGENTS.md");
  await writeFile(file, "ORIGINAL\r\n");
  const agent = {
    id: "chat",
    provider: "custom",
    workspaceId: "workspace",
    title: "Chat",
    sessionId: "session",
    internal: false,
  };
  const host = new ContextManagementService({
    hostId: "host",
    home,
    workspaces: { get: async () => ({ workspaceId: "workspace", cwd: root, archivedAt: null }) },
    agents: { get: () => (captured ? agent : null), list: () => (captured ? [agent] : []) },
    providerOwner: () => (captured ? "provider" : undefined),
    invoke: async () => ({
      ok: true,
      value: {
        capturedAt: "2026-10-26T00:00:00Z",
        phase: "completed",
        system: "CAPTURED",
        instructionText: "CAPTURED",
        tools: "[]",
        blocks: [{ file, scope: root, text: "CAPTURED" }],
      },
    }),
  });
  const scope = {
    hostId: "host",
    workspaceId: "workspace",
    agentId: captured ? "chat" : null,
    windowTokens: 200000,
  };
  const read = async (nodeId = instructionDigest(file)) => {
    const result = readContextSourceFile.output.parse(
      await host.invoke(readContextSourceFile.name, { ...scope, nodeId }),
    );
    if (!result.ok) throw Error(result.error.message);
    return result.value;
  };
  const save = async (expectedRevision: string, text: string, extra = {}) =>
    saveContextSourceFile.output.parse(
      await host.invoke(saveContextSourceFile.name, {
        ...scope,
        nodeId: instructionDigest(file),
        expectedRevision,
        text,
        userApprovedSave: true,
        userApprovedGlobal: false,
        ...extra,
      }),
    );
  return { host, root, home, file, scope, read, save };
}
afterEach(async () => {
  for (const directory of fixtures.splice(0)) {
    if (!directory.startsWith(temporary)) throw Error("Fixture boundary");
    await rm(directory, { recursive: true, force: true });
  }
});
test("the current source editor reads fresh bytes while captured prompt inspection stays historical", async () => {
  const f = await fixture(true);
  const report = readContextReport.output.parse(
    await f.host.invoke(readContextReport.name, f.scope),
  );
  if (!report.ok) throw Error("Report failed");
  const preview = readContextPreview.output.parse(
    await f.host.invoke(readContextPreview.name, {
      ...f.scope,
      nodeId: instructionDigest(f.file),
      category: null,
      revision: report.value.revision,
    }),
  );
  expect(preview).toMatchObject({ ok: true, value: { text: "CAPTURED" } });
  expect(await f.read()).toMatchObject({
    text: "ORIGINAL\r\n",
    revision: instructionDigest("ORIGINAL\r\n"),
    writable: true,
  });
});
test("an approved current-source CAS preserves exact text and closes its own staging/lock files", async () => {
  const f = await fixture(),
    source = await f.read();
  expect(await f.save(source.revision, "NEW\r\n\r\nSOURCE\r\n")).toMatchObject({
    ok: true,
    value: { changed: true },
  });
  expect(await readFile(f.file, "utf8")).toBe("NEW\r\n\r\nSOURCE\r\n");
  expect((await readdir(f.root)).filter((name) => name.includes("otto-context"))).toEqual([]);
});
test("declined saves and peer conflicts never replace the original or newer bytes", async () => {
  const f = await fixture(),
    source = await f.read();
  expect(await f.save(source.revision, "DECLINED", { userApprovedSave: false })).toMatchObject({
    ok: false,
  });
  expect(await readFile(f.file, "utf8")).toBe(source.text);
  await writeFile(f.file, "PEER");
  expect(await f.save(source.revision, "STALE")).toMatchObject({
    ok: false,
    error: { code: "conflict" },
  });
  expect(await readFile(f.file, "utf8")).toBe("PEER");
});
test("a host-wide file requires its own explicit scope approval in addition to Save", async () => {
  const f = await fixture();
  const global = path.join(f.home, "AGENTS.md");
  await writeFile(global, "GLOBAL");
  const source = await f.read(instructionDigest(global));
  expect(source.scope).toBe("host");
  expect(await f.save(source.revision, "GLOBAL EDIT", { nodeId: source.nodeId })).toMatchObject({
    ok: false,
  });
  expect(await readFile(global, "utf8")).toBe("GLOBAL");
  expect(
    await f.save(source.revision, "GLOBAL EDIT", {
      nodeId: source.nodeId,
      userApprovedGlobal: true,
    }),
  ).toMatchObject({ ok: true });
  expect(await readFile(global, "utf8")).toBe("GLOBAL EDIT");
});
test("forged source identity and vanished catalog entries cannot become arbitrary path writes", async () => {
  const f = await fixture();
  await expect(f.read("../private-file")).rejects.toThrow("no longer in the context graph");
  await writeFile(f.file, "[Available](optional.md)");
  const optional = path.join(f.root, "optional.md");
  await writeFile(optional, "OPTIONAL");
  const source = await f.read(instructionDigest(optional));
  expect(source.writable).toBe(true);
  await writeFile(f.file, "NO REFERENCE");
  expect(await f.save(source.revision, "FORGED", { nodeId: source.nodeId })).toMatchObject({
    ok: false,
    error: { code: "conflict" },
  });
  expect(await readFile(optional, "utf8")).toBe("OPTIONAL");
});
test("multiply linked files are read-only and the write path independently refuses them", async () => {
  const f = await fixture();
  await link(f.file, path.join(f.root, "alias.md"));
  const source = await f.read();
  expect(source).toMatchObject({ writable: false, readOnlyReason: expect.any(String) });
  expect(await f.save(source.revision, "REJECTED")).toMatchObject({ ok: false });
  expect(await readFile(f.file, "utf8")).toBe(source.text);
});
test("occupied writer locks and lossy or oversized output have no automatic retry", async () => {
  const f = await fixture(),
    source = await f.read();
  await writeFile(f.file + ".otto-context-lock", "OTHER WRITER");
  expect(await f.save(source.revision, "BLOCKED")).toMatchObject({
    ok: false,
    error: { code: "busy" },
  });
  expect(await readFile(f.file + ".otto-context-lock", "utf8")).toBe("OTHER WRITER");
  await rm(f.file + ".otto-context-lock");
  for (const text of ["\uD800", "é".repeat(65537)])
    expect(await f.save(source.revision, text)).toMatchObject({ ok: false });
  expect(await readFile(f.file, "utf8")).toBe(source.text);
});
