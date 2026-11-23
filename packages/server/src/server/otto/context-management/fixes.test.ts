import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, realpath, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { afterEach, expect, test } from "vitest";
import { readContextReport, fixContextFindings } from "@getpaseo/plugin/otto/context-management";
import { instructionDigest } from "@getpaseo/plugin/server/otto-openai";
import { ContextManagementService } from "./host.js";
import { rewriteContextFile } from "./source-write.js";
const temporary = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const fixtures: string[] = [];
const rule =
  "Always preserve every unrelated user setting and keep all products compatible across updates.";
async function fixture(text: string) {
  await mkdir(temporary, { recursive: true });
  const created = await mkdtemp(path.join(temporary, "context-fixes-"));
  fixtures.push(created);
  const directory = await realpath(created),
    root = path.join(directory, "project"),
    home = path.join(directory, "home");
  await mkdir(root);
  await mkdir(home);
  const file = path.join(root, "AGENTS.md");
  await writeFile(path.join(root, ".git"), "fixture");
  await writeFile(file, text);
  const host = new ContextManagementService({
    hostId: "host",
    home,
    workspaces: { get: async () => ({ workspaceId: "workspace", cwd: root, archivedAt: null }) },
    agents: { get: () => null, list: () => [] },
    providerOwner: () => undefined,
    invoke: async () => {
      throw Error("No provider invocation permitted");
    },
  });
  const selection = {
    hostId: "host",
    workspaceId: "workspace",
    agentId: null,
    windowTokens: 200000,
  };
  const report = async () => {
    const response = readContextReport.output.parse(
      await host.invoke(readContextReport.name, selection),
    );
    if (!response.ok) throw Error(response.error.message);
    return response.value;
  };
  const fix = async (
    current: Awaited<ReturnType<typeof report>>,
    ids = current.findingDetails!.filter((finding) => finding.fixable).map((finding) => finding.id),
    approved = true,
  ) =>
    fixContextFindings.output.parse(
      await host.invoke(fixContextFindings.name, {
        ...selection,
        revision: current.revision,
        findingIds: ids,
        userApprovedFixes: approved,
      }),
    );
  return { root, home, file, report, fix };
}
afterEach(async () => {
  for (const directory of fixtures.splice(0)) {
    if (!directory.startsWith(temporary)) throw Error("Fixture boundary");
    await rm(directory, { recursive: true, force: true });
  }
});
test("reviewed duplicate removal uses the real host writer, preserves CRLF and leaves no lock/staging files", async () => {
  const f = await fixture(`Header\r\n\r\n${rule}\r\n\r\n${rule}\r\n`);
  const result = await f.fix(await f.report());
  expect(result).toMatchObject({
    ok: true,
    value: { files: [{ status: "changed", fixedCount: 1 }] },
  });
  expect(await readFile(f.file, "utf8")).toBe(`Header\r\n\r\n${rule}\r\n\r\n`);
  expect((await readdir(f.root)).filter((name) => name.includes("otto-context"))).toEqual([]);
});
test("cross-scope repair preserves the global rule for all other projects", async () => {
  const f = await fixture(`${rule}\n\nProject-specific guidance.\n`);
  const global = path.join(f.home, "AGENTS.md");
  await writeFile(global, rule);
  const result = await f.fix(await f.report());
  expect(result).toMatchObject({
    ok: true,
    value: { files: [{ label: "AGENTS.md", status: "changed" }] },
  });
  expect(await readFile(global, "utf8")).toBe(rule);
  expect(await readFile(f.file, "utf8")).toBe("\nProject-specific guidance.\n");
});
test("declined approval never acquires an edit lock or changes the source", async () => {
  const text = "@gone.md";
  const f = await fixture(text);
  const report = await f.report();
  expect(report.instructionState).toBe("blocked");
  expect(await f.fix(report, undefined, false)).toMatchObject({ ok: false });
  expect(await readFile(f.file, "utf8")).toBe(text);
  expect((await readdir(f.root)).filter((name) => name.includes("otto-context"))).toEqual([]);
});
test("a peer edit invalidates the report before any mechanical removal", async () => {
  const f = await fixture("@gone.md"),
    report = await f.report();
  await writeFile(f.file, "PEER CONTENT");
  expect(await f.fix(report)).toMatchObject({ ok: false, error: { code: "conflict" } });
  expect(await readFile(f.file, "utf8")).toBe("PEER CONTENT");
});
test("occupied locks are retained and reported without retrying the write", async () => {
  const f = await fixture("@gone.md"),
    report = await f.report();
  await writeFile(f.file + ".otto-context-lock", "EXISTING WRITER");
  expect(await f.fix(report)).toMatchObject({
    ok: true,
    value: { files: [{ status: "unavailable", fixedCount: 0 }] },
  });
  expect(await readFile(f.file, "utf8")).toBe("@gone.md");
  expect(await readFile(f.file + ".otto-context-lock", "utf8")).toBe("EXISTING WRITER");
});
test("unknown IDs reject the entire plan before applying even its valid findings", async () => {
  const f = await fixture("@gone.md"),
    report = await f.report();
  const ids = [...report.findingDetails!.map((finding) => finding.id), "client-forged-span"];
  expect(await f.fix(report, ids)).toMatchObject({ ok: false, error: { code: "conflict" } });
  expect(await readFile(f.file, "utf8")).toBe("@gone.md");
});
test("cycles remain review-only and cannot be forced into a mechanical deletion", async () => {
  const f = await fixture("@AGENTS.md"),
    report = await f.report();
  const cycles = report.findingDetails!.filter((finding) => finding.kind === "import_cycle");
  expect(cycles).toHaveLength(1);
  expect(
    await f.fix(
      report,
      cycles.map((finding) => finding.id),
    ),
  ).toMatchObject({ ok: false });
  expect(await readFile(f.file, "utf8")).toBe("@AGENTS.md");
});
test("multi-file partial results name every outcome and preserve a blocked file without rollback/retry", async () => {
  const f = await fixture("@second.md\n@missing-first.md");
  const second = path.join(f.root, "second.md");
  await writeFile(second, "@missing-second.md");
  const report = await f.report();
  await writeFile(second + ".otto-context-lock", "OTHER WRITER");
  const result = await f.fix(report);
  expect(result).toMatchObject({
    ok: true,
    value: {
      files: [
        { label: "AGENTS.md", status: "changed", fixedCount: 1 },
        { label: "second.md", status: "unavailable", fixedCount: 0 },
      ],
    },
  });
  expect(await readFile(f.file, "utf8")).toBe("@second.md\n");
  expect(await readFile(second, "utf8")).toBe("@missing-second.md");
});
test("the common source writer rejects lossy/oversized output before staging and treats unchanged text as a no-op", async () => {
  const f = await fixture("ORIGINAL");
  for (const after of ["\uD800", "é".repeat(65537)])
    await expect(
      rewriteContextFile({
        root: f.root,
        file: f.file,
        expectedRevision: instructionDigest("ORIGINAL"),
        rewrite: () => after,
      }),
    ).rejects.toThrow("UTF-8");
  expect(
    await rewriteContextFile({
      root: f.root,
      file: f.file,
      expectedRevision: instructionDigest("ORIGINAL"),
      rewrite: (before) => before,
    }),
  ).toBe(false);
  expect(await readFile(f.file, "utf8")).toBe("ORIGINAL");
  expect((await readdir(f.root)).filter((name) => name.includes("otto-context"))).toEqual([]);
});
