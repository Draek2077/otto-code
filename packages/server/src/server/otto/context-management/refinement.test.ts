import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, realpath, writeFile, readFile, rm } from "node:fs/promises";
import { afterEach, expect, test } from "vitest";
import {
  readContextRefinementSet,
  proposeContextRefinement,
  applyContextRefinement,
  type ContextRefinementSet,
} from "@getpaseo/plugin/otto/context-management";
import { instructionDigest } from "@getpaseo/plugin/server/otto-openai";
import type { StructuredTextGeneration } from "../../session/checkout/git-metadata-generator.js";
import { ContextManagementService } from "./host.js";
import { isRefinableDocument } from "./refine-scope.js";

const temporary = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const fixtures: string[] = [];
async function fixture() {
  await mkdir(temporary, { recursive: true });
  const created = await mkdtemp(path.join(temporary, "context-refinement-"));
  fixtures.push(created);
  const directory = await realpath(created),
    root = path.join(directory, "project"),
    home = path.join(directory, "home");
  await mkdir(root);
  await mkdir(home);
  await writeFile(path.join(root, ".git"), "fixture");
  const file = path.join(root, "AGENTS.md"),
    second = path.join(root, "second.md"),
    reference = path.join(root, "reference.md"),
    code = path.join(root, "sample.ts");
  const original = "ROOT\n[Second](second.md)\n[Context](reference.md)\n[Code](sample.ts)";
  await writeFile(file, original);
  await writeFile(second, "SECOND");
  await writeFile(reference, "READ_ONLY_CONTEXT");
  await writeFile(code, "export const code = 1;");
  let response: unknown = { files: [] };
  let failure: Error | null = null;
  const calls: string[] = [];
  const generation: StructuredTextGeneration = {
    async generate(request) {
      calls.push(request.prompt);
      if (failure) throw failure;
      return request.schema.parse(response);
    },
  };
  const host = new ContextManagementService({
    hostId: "host",
    home,
    workspaces: { get: async () => ({ workspaceId: "workspace", cwd: root, archivedAt: null }) },
    agents: { get: () => null, list: () => [] },
    providerOwner: () => undefined,
    invoke: async () => {
      throw Error("No provider inspection permitted");
    },
    generation: () => generation,
  });
  const scope = { hostId: "host", workspaceId: "workspace", agentId: null, windowTokens: 200000 };
  const id = (value: string) => instructionDigest(value);
  const load = async (nodeIds = [id(file)], referenceNodeIds = [id(reference)]) => {
    const result = readContextRefinementSet.output.parse(
      await host.invoke(readContextRefinementSet.name, { ...scope, nodeIds, referenceNodeIds }),
    );
    if (!result.ok) throw Error(result.error.message);
    return result.value;
  };
  const documents = (set: ContextRefinementSet) =>
    set.documents.map((item) => ({
      nodeId: item.nodeId,
      expectedRevision: item.revision,
      text: item.text,
    }));
  const propose = async (set: ContextRefinementSet, extra = {}) =>
    proposeContextRefinement.output.parse(
      await host.invoke(proposeContextRefinement.name, {
        ...scope,
        documents: documents(set),
        references: set.references.map((item) => ({
          nodeId: item.nodeId,
          expectedRevision: item.revision,
        })),
        instruction: "Remove redundant phrasing, preserving every distinct rule and link.",
        ...extra,
      }),
    );
  const apply = async (set: ContextRefinementSet, text: string, extra = {}) =>
    applyContextRefinement.output.parse(
      await host.invoke(applyContextRefinement.name, {
        ...scope,
        documents: documents(set).map((item) => ({
          nodeId: item.nodeId,
          expectedRevision: item.expectedRevision,
          text,
        })),
        userApprovedSave: true,
        userApprovedGlobal: false,
        ...extra,
      }),
    );
  return {
    root,
    home,
    file,
    second,
    reference,
    code,
    original,
    id,
    load,
    propose,
    apply,
    documents,
    calls,
    respond: (next: unknown) => {
      response = next;
    },
    fail: (error: Error) => {
      failure = error;
    },
  };
}
afterEach(async () => {
  for (const directory of fixtures.splice(0)) {
    if (!directory.startsWith(temporary)) throw Error("Fixture boundary");
    await rm(directory, { recursive: true, force: true });
  }
});
test("loading a reviewed set is read-only and preserves separate rewritable/reference identities", async () => {
  const f = await fixture(),
    set = await f.load();
  expect(set.documents.map((file) => file.nodeId)).toEqual([f.id(f.file)]);
  expect(set.references).toMatchObject([{ nodeId: f.id(f.reference), characters: 17 }]);
  expect(f.calls).toEqual([]);
  expect(await readFile(f.file, "utf8")).toBe(f.original);
  await expect(f.load([f.id(f.code)])).rejects.toThrow("context graph");
});
test("prose eligibility is extension-based and never inferred from code-looking or prose-looking content", () => {
  for (const file of [
    "CLAUDE.md",
    "MEMORY.markdown",
    "README.txt",
    "LICENSE",
    "doc.rst",
    "notes.org",
    "C:\\project\\TEAM.MD",
  ])
    expect(isRefinableDocument(file)).toBe(true);
  for (const file of ["app.ts", "script.py", "config.json", ".env", "index.html", "styles.css"])
    expect(isRefinableDocument(file)).toBe(false);
});
test("references are smallest-first, complete and capped at twelve files/60KB without silently widening rewrite scope", async () => {
  const f = await fixture();
  const files = Array.from({ length: 14 }, (_, index) => path.join(f.root, `context-${index}.md`));
  files.push(path.join(f.root, "huge.md"));
  for (const [index, file] of files.entries())
    await writeFile(file, file.endsWith("huge.md") ? "H".repeat(60001) : "R".repeat(index + 1));
  await writeFile(f.file, files.map((file) => `[Context](${path.basename(file)})`).join("\n"));
  const set = await f.load([f.id(f.file)], files.toReversed().map(f.id));
  expect(set.references).toHaveLength(12);
  expect(set.references.map((file) => file.characters)).toEqual(
    Array.from({ length: 12 }, (_, index) => index + 1),
  );
  expect(set.omittedReferences).toBe(3);
  expect(set.documents).toHaveLength(1);
});
test("one-shot generation sees only the reviewed working documents and read-only references and writes nothing", async () => {
  const f = await fixture(),
    set = await f.load();
  f.respond({ files: [{ id: f.id(f.file), content: "PROPOSED" }] });
  const result = await f.propose(set, {
    documents: [
      {
        nodeId: f.id(f.file),
        expectedRevision: set.documents[0]!.revision,
        text: "UNSAVED_WORKING_TEXT",
      },
    ],
  });
  expect(result).toMatchObject({
    ok: true,
    value: {
      files: [{ nodeId: f.id(f.file), base: "UNSAVED_WORKING_TEXT", proposal: "PROPOSED" }],
    },
  });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toContain("readOnlyReferences");
  expect(f.calls[0]).toContain("READ_ONLY_CONTEXT");
  expect(f.calls[0]).toContain("UNSAVED_WORKING_TEXT");
  expect(await readFile(f.file, "utf8")).toBe(f.original);
  expect(await readFile(f.reference, "utf8")).toBe("READ_ONLY_CONTEXT");
});
test("omitted proposal documents remain exactly their working text", async () => {
  const f = await fixture(),
    set = await f.load();
  expect(await f.propose(set)).toMatchObject({
    ok: true,
    value: { files: [{ base: f.original, proposal: f.original }] },
  });
});
test.each(["unknown", "reference"])(
  "model-returned %s IDs cannot escape the rewritable set",
  async (kind) => {
    const f = await fixture(),
      set = await f.load();
    f.respond({
      files: [{ id: kind === "unknown" ? "invented" : f.id(f.reference), content: "FORBIDDEN" }],
    });
    expect(await f.propose(set)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("unknown or repeated") },
    });
    expect(await readFile(f.reference, "utf8")).toBe("READ_ONLY_CONTEXT");
  },
);
test("repeated response IDs and unsupported Unicode are refused without a write", async () => {
  const f = await fixture(),
    set = await f.load();
  f.respond({
    files: [
      { id: f.id(f.file), content: "A" },
      { id: f.id(f.file), content: "B" },
    ],
  });
  expect(await f.propose(set)).toMatchObject({ ok: false });
  f.respond({ files: [{ id: f.id(f.file), content: "\uD800" }] });
  expect(await f.propose(set)).toMatchObject({ ok: false });
  expect(await readFile(f.file, "utf8")).toBe(f.original);
});
test.each(["document", "reference"])(
  "stale %s revisions refuse generation before a model call",
  async (kind) => {
    const f = await fixture(),
      set = await f.load();
    await writeFile(kind === "document" ? f.file : f.reference, "PEER");
    expect(await f.propose(set)).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(f.calls).toEqual([]);
  },
);
test("generation failures expose safe recovery copy rather than provider diagnostics", async () => {
  const f = await fixture(),
    set = await f.load();
  f.fail(Error("SENSITIVE_PROVIDER_DIAGNOSTIC"));
  const result = await f.propose(set);
  expect(result).toMatchObject({
    ok: false,
    error: {
      message:
        "The selected generation service could not produce a valid proposal. No documents were changed.",
    },
  });
  expect(JSON.stringify(result)).not.toContain("SENSITIVE_PROVIDER_DIAGNOSTIC");
});
test("the full kept set is preflighted before saving and declined/global approvals preserve every file", async () => {
  const f = await fixture(),
    set = await f.load();
  expect(await f.apply(set, "DECLINED", { userApprovedSave: false })).toMatchObject({ ok: false });
  expect(await readFile(f.file, "utf8")).toBe(f.original);
  const global = path.join(f.home, "AGENTS.md");
  await writeFile(global, "GLOBAL");
  const both = await f.load([f.id(f.file), f.id(global)], []);
  expect(await f.apply(both, "GLOBAL EDIT")).toMatchObject({ ok: false });
  expect(await readFile(f.file, "utf8")).toBe(f.original);
  expect(await readFile(global, "utf8")).toBe("GLOBAL");
  const edited = await f.apply(both, "KEPT", { userApprovedGlobal: true });
  expect(edited).toMatchObject({
    ok: true,
    value: { files: [{ status: "changed" }, { status: "changed" }] },
  });
  expect(await readFile(global, "utf8")).toBe("KEPT");
  expect(f.calls).toEqual([]);
});
test("per-file lock failures preserve partial outcomes without rollback, lock theft or retries", async () => {
  const f = await fixture(),
    set = await f.load([f.id(f.file), f.id(f.second)], []);
  await writeFile(f.second + ".otto-context-lock", "OTHER WRITER");
  const result = await f.apply(set, "KEPT");
  expect(result).toMatchObject({
    ok: true,
    value: {
      files: [
        { nodeId: f.id(f.file), status: "changed", revision: instructionDigest("KEPT") },
        { nodeId: f.id(f.second), status: "unavailable", revision: null },
      ],
    },
  });
  expect(await readFile(f.file, "utf8")).toBe("KEPT");
  expect(await readFile(f.second, "utf8")).toBe("SECOND");
  expect(await readFile(f.second + ".otto-context-lock", "utf8")).toBe("OTHER WRITER");
});
test("stale multi-file preflight changes nothing, including earlier valid documents", async () => {
  const f = await fixture(),
    set = await f.load([f.id(f.file), f.id(f.second)], []);
  await writeFile(f.second, "PEER");
  expect(await f.apply(set, "STALE")).toMatchObject({ ok: false, error: { code: "conflict" } });
  expect(await readFile(f.file, "utf8")).toBe(f.original);
  expect(await readFile(f.second, "utf8")).toBe("PEER");
});
