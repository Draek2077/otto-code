import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pino from "pino";
import {
  getCapabilities,
  getProjectConfiguration,
  setProjectTarget,
  getBoard,
} from "@getpaseo/plugin/otto/kanban";
import { readFieldsDocument } from "@getpaseo/plugin/server/otto-kanban";
import {
  createPersistedProjectRecord,
  FileBackedProjectRegistry,
} from "../../workspace-registry.js";
import { KanbanDaemonService } from "./service.js";
import { createKanbanTools } from "./tools.js";
import { compilePlugin } from "../../plugins/compiler.js";
import { evaluateBundle } from "../../plugins/bundle-evaluator.js";

const parent = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const roots: string[] = [];
it("keeps the actual Kanban setup callable after eager bundle interop", async () => {
  const directory = fileURLToPath(
    new URL("../../../../../../plugins/otto-kanban/", import.meta.url),
  );
  const bundles = await compilePlugin({
    server: path.join(directory, "index.server.ts"),
    client: path.join(directory, "index.client.tsx"),
  });
  if (!bundles.serverBundle) throw new Error("Kanban server entry did not compile");
  expect(typeof evaluateBundle(bundles.serverBundle)).toBe("function");
});
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected Kanban fixture path");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture(configured = true) {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "kanban-daemon-"));
  roots.push(root);
  const file = path.join(root, "projects.json");
  const record = {
    ...createPersistedProjectRecord({
      projectId: "project-a",
      rootPath: root,
      kind: "git",
      displayName: "Project A",
      createdAt: "2026-10-24T00:00:00Z",
      updatedAt: "2026-10-24T00:00:00Z",
    }),
    kanban: configured ? { adapter: "github", boardId: "PVT_saved", future: { keep: true } } : null,
    knowledgeDirectoryName: "retained-name",
    privateMetadata: "never-return-this",
  };
  await writeFile(file, JSON.stringify([record]));
  const registry = new FileBackedProjectRegistry(file, pino({ level: "silent" }));
  const queries: Array<{
    cwd: string;
    document: string;
    variables: Record<string, string | number | null>;
  }> = [];
  const service = new KanbanDaemonService({
    hostId: "host-a",
    operationDirectory: path.join(root, "operations"),
    writes: {
      execute: async () => {
        throw new Error("Unexpected provider write");
      },
    },
    metadata: registry.ottoMetadata,
    github: {
      repository: async () => ({ owner: "owner", repository: "repo" }),
      query: async (input) => {
        queries.push(input);
        return {
          ok: false,
          error: { code: "scope_required", message: "Enable Projects read access on this host." },
        };
      },
    },
  });
  const binding = { hostId: "host-a", projectId: "project-a" };
  const configuration = async () =>
    getProjectConfiguration.output.parse(
      await service.invoke(getProjectConfiguration.name, binding),
    );
  return {
    root,
    file,
    record,
    registry,
    service,
    binding,
    queries,
    configuration,
    bytes: () => readFile(file, "utf8"),
  };
}

it("returns sanitized project settings from the actual preserved registry without contacting GitHub", async () => {
  const f = await fixture();
  const before = await f.bytes();
  const result = await f.configuration();
  expect(result).toMatchObject({
    ok: true,
    value: { binding: f.binding, target: { adapter: "github", boardId: "PVT_saved" } },
  });
  expect(JSON.stringify(result)).not.toContain("never-return-this");
  expect(f.queries).toEqual([]);
  expect(await f.bytes()).toBe(before);
});

it("normalizes and saves a project target through the shared registry CAS without losing dormant fields", async () => {
  const f = await fixture();
  const opened = await f.registry.ottoMetadata.read("project-a");
  const result = setProjectTarget.output.parse(
    await f.service.invoke(setProjectTarget.name, {
      binding: f.binding,
      expectedRevision: opened.revision,
      target: { adapter: "github", boardId: "https://github.com/orgs/example/projects/9" },
    }),
  );
  expect(result).toMatchObject({
    ok: true,
    value: {
      binding: f.binding,
      target: { adapter: "github", boardId: "9", boardOwner: "example" },
    },
  });
  expect((await f.registry.ottoMetadata.read("project-a")).record).toEqual({
    ...f.record,
    kanban: { adapter: "github", boardId: "9", boardOwner: "example", future: { keep: true } },
  });
  expect(JSON.stringify(result)).not.toContain("never-return-this");
});

it("retains a peer rename and target when the opened target revision becomes stale", async () => {
  const f = await fixture();
  const opened = await f.registry.ottoMetadata.read("project-a");
  await f.registry.update("project-a", (record) => ({ ...record, displayName: "Peer name" }));
  const before = await f.bytes();
  expect(
    await f.service.invoke(setProjectTarget.name, {
      binding: f.binding,
      expectedRevision: opened.revision,
      target: null,
    }),
  ).toMatchObject({ ok: false, error: { code: "revision_conflict" } });
  expect(await f.bytes()).toBe(before);
});

it("clears only the selected project's target", async () => {
  const f = await fixture();
  const opened = await f.registry.ottoMetadata.read("project-a");
  expect(
    await f.service.invoke(setProjectTarget.name, {
      binding: f.binding,
      expectedRevision: opened.revision,
      target: null,
    }),
  ).toMatchObject({ ok: true, value: { target: null } });
  expect((await f.registry.ottoMetadata.read("project-a")).record).toEqual({
    ...f.record,
    kanban: null,
  });
});

it("uses the registry's owning path for official queries and returns typed provider errors", async () => {
  const f = await fixture();
  expect(getBoard.output.parse(await f.service.invoke(getBoard.name, f.binding))).toMatchObject({
    status: "error",
    binding: f.binding,
    error: { code: "scope_required" },
  });
  expect(f.queries).toEqual([
    { cwd: f.root, document: readFieldsDocument, variables: { id: "PVT_saved", cursor: null } },
  ]);
});

it("returns an unconfigured board without a provider request", async () => {
  const f = await fixture(false);
  expect(await f.service.invoke(getBoard.name, f.binding)).toMatchObject({
    status: "unconfigured",
    binding: f.binding,
  });
  expect(f.queries).toEqual([]);
});

it("refuses cross-host bindings before provider access", async () => {
  const f = await fixture();
  expect(
    await f.service.invoke(getProjectConfiguration.name, { ...f.binding, hostId: "other-host" }),
  ).toMatchObject({ ok: false, error: { code: "wrong_host" } });
  expect(await f.service.invoke(getCapabilities.name, { hostId: "other-host" })).toMatchObject({
    ok: false,
    error: { code: "wrong_host" },
  });
  expect(f.queries).toEqual([]);
});

it("does not recover a removed project through a caller-supplied filesystem path", async () => {
  const f = await fixture();
  await f.registry.remove("project-a");
  expect(await f.configuration()).toMatchObject({
    ok: false,
    error: { code: "project_not_found" },
  });
  await expect(
    f.service.invoke(getProjectConfiguration.name, { ...f.binding, rootPath: f.root }),
  ).rejects.toThrow();
  expect(f.queries).toEqual([]);
});

it("refuses arbitrary vendor queries and unvalidated mutation requests", async () => {
  const f = await fixture();
  expect(f.service.invoke("kanban.vendor.query", { document: "mutation {}" })).toBe(undefined);
  await expect(f.service.invoke("kanban.board.mutate", {})).rejects.toThrow();
  expect(f.queries).toEqual([]);
});
it("exposes the actual configured-project provider error through the same agent tool boundary without changing settings", async () => {
  const f = await fixture();
  const before = await f.bytes();
  const tools = createKanbanTools(f.service, async () => f.binding);
  const list = tools.find((tool) => tool.name === "kanban_list_boards");
  const read = tools.find((tool) => tool.name === "kanban_get_board");
  if (!list || !read) throw new Error("Missing configured Kanban tools");
  expect(await list.handler({}, {})).toMatchObject({
    isError: true,
    structuredContent: { status: "error", binding: f.binding, error: { code: "scope_required" } },
  });
  expect(await read.handler({}, {})).toMatchObject({
    isError: true,
    structuredContent: { error: { code: "scope_required" } },
  });
  expect(f.queries.length).toBeGreaterThan(0);
  expect(await f.bytes()).toBe(before);
});
