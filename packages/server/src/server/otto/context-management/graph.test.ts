import { mkdir, mkdtemp, realpath, rm, writeFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import {
  InstructionSource,
  instructionReferences,
  instructionDigest,
} from "@getpaseo/plugin/server/otto-openai";
import { buildContextGraph } from "./graph.js";
import { changeInstructionEdge, ContextConflict, ContextBusy } from "./source-write.js";
import { withContextCleanup } from "./cleanup.js";

const temporary = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const fixtures: string[] = [];
async function fixture() {
  await mkdir(temporary, { recursive: true });
  const directory = await mkdtemp(path.join(temporary, "context-graph-"));
  fixtures.push(directory);
  const root = path.join(directory, "project"),
    home = path.join(directory, "home");
  await mkdir(root);
  await mkdir(home);
  await writeFile(path.join(root, ".git"), "fixture");
  return { root: await realpath(root), home: await realpath(home) };
}
afterEach(async () => {
  for (const directory of fixtures.splice(0)) {
    const relative = path.relative(temporary, directory);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Fixture escaped scratch root");
    await rm(directory, { recursive: true, force: true });
  }
});

test("parser preserves source offsets and excludes fences, inline code, images and remote links", () => {
  const text =
    "🙂\r\n@rules.md\r\n[Available](docs.md#part)\r\n`@inline.md`\r\n````md\r\n```\r\n@fenced.md\r\n````\r\n![Image](image.md) [Web](https://example.org/read.md)\r\n";
  const refs = instructionReferences(text);
  expect(refs.map((ref) => [ref.kind, ref.target])).toEqual([
    ["import", "rules.md"],
    ["reference", "docs.md"],
  ]);
  expect(refs.map((ref) => text.slice(ref.start, ref.end))).toEqual([
    "@rules.md",
    "[Available](docs.md#part)",
  ]);
});
test("one runtime resolver deduplicates loaded imports; linked bodies are not loaded or counted", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, "AGENTS.md"),
    "ROOT\n@rules.md\n@rules.md\n[Optional](optional.md)",
  );
  await writeFile(path.join(f.root, "rules.md"), "RULES");
  await writeFile(path.join(f.root, "optional.md"), "NOT_FIXED".repeat(100));
  const source = await InstructionSource.create({ cwd: f.root, home: f.home });
  const inspected = await source.inspect();
  const graph = await buildContextGraph({ ...f, cwd: f.root, blocks: inspected.blocks });
  expect(graph.nodes.filter((node) => node.costClass === "fixed")).toHaveLength(2);
  expect(graph.nodes.find((node) => node.label === "optional.md")).toMatchObject({
    costClass: "referenced",
    estimatedTokens: 0,
    characters: 0,
    editable: false,
  });
  expect(inspected.text).not.toContain("NOT_FIXED");
  expect(graph.edges.map((edge) => edge.kind)).toEqual(["import", "import", "reference"]);
});
test("reports missing and outside references without reading their bodies", async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, "AGENTS.md"), "[Missing](absent.md)\n[Escape](../outside.md)");
  await writeFile(path.join(path.dirname(f.root), "outside.md"), "PRIVATE_OUTSIDE");
  const source = await InstructionSource.create({ cwd: f.root, home: f.home });
  const graph = await buildContextGraph({
    ...f,
    cwd: f.root,
    blocks: (await source.inspect()).blocks,
  });
  expect(graph.edges.every((edge) => edge.to === null)).toBe(true);
  expect(graph.findings).toHaveLength(2);
  expect([...graph.sources.values()].map((item) => item.text).join()).not.toContain(
    "PRIVATE_OUTSIDE",
  );
});
test("inspection diagnoses a missing hard import while request preparation and write admission remain fail-closed", async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, "AGENTS.md"), "ROOT\n@gone.md");
  const target = path.join(f.root, "target.txt");
  await writeFile(target, "ORIGINAL");
  const source = await InstructionSource.create({ cwd: f.root, home: f.home });
  const inspected = await source.inspect();
  expect(inspected.blocks.map((block) => block.text)).toEqual(["ROOT\n@gone.md"]);
  expect(inspected.issues).toMatchObject([
    { kind: "missing", parentFile: path.join(f.root, "AGENTS.md"), target: "gone.md" },
  ]);
  expect(source.preparedBlocks()).toEqual([]);
  await expect(source.forRequest()).rejects.toThrow();
  await expect(source.beforeFile({ file: target, write: true })).rejects.toThrow();
  expect(await readFile(target, "utf8")).toBe("ORIGINAL");
});
test("failed instruction inspection is bounded without relaxing the runtime import limits", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, "AGENTS.md"),
    Array.from({ length: 300 }, (_, index) => `@missing-${index}.md`).join("\n"),
  );
  const source = await InstructionSource.create({ cwd: f.root, home: f.home });
  const inspected = await source.inspect();
  expect(inspected.issues).toHaveLength(32);
  expect(inspected.issues[31]?.kind).toBe("limit");
  await expect(source.forRequest()).rejects.toThrow();
});
test("changing one reviewed import preserves CRLF and unrelated source bytes", async () => {
  const f = await fixture();
  const file = path.join(f.root, "AGENTS.md"),
    before = "Intro\r\n@rules.md\r\nTail 🙂\r\n";
  await writeFile(file, before);
  await writeFile(path.join(f.root, "rules.md"), "RULE");
  const reference = instructionReferences(before)[0]!;
  expect(
    await changeInstructionEdge({
      root: f.root,
      edge: { ...reference, file },
      expectedRevision: instructionDigest(before),
      mode: "reference",
    }),
  ).toBe(true);
  expect(await readFile(file, "utf8")).toBe("Intro\r\n[rules.md](rules.md)\r\nTail 🙂\r\n");
  expect((await readdir(f.root)).some((name) => name.includes("otto-context"))).toBe(false);
});
test("a peer edit is preserved and the failed writer releases only its own files", async () => {
  const f = await fixture();
  const file = path.join(f.root, "AGENTS.md"),
    before = "@rules.md\n";
  await writeFile(file, "PEER CHANGE\n");
  await expect(
    changeInstructionEdge({
      root: f.root,
      edge: { ...instructionReferences(before)[0]!, file },
      expectedRevision: instructionDigest(before),
      mode: "reference",
    }),
  ).rejects.toBeInstanceOf(ContextConflict);
  expect(await readFile(file, "utf8")).toBe("PEER CHANGE\n");
  expect((await readdir(f.root)).some((name) => name.includes("otto-context"))).toBe(false);
});
test("an occupied edit lock is neither stolen nor removed", async () => {
  const f = await fixture();
  const file = path.join(f.root, "AGENTS.md"),
    before = "@rules.md";
  await writeFile(file, before);
  await writeFile(file + ".otto-context-lock", "PEER LOCK");
  await expect(
    changeInstructionEdge({
      root: f.root,
      edge: { ...instructionReferences(before)[0]!, file },
      expectedRevision: instructionDigest(before),
      mode: "reference",
    }),
  ).rejects.toBeInstanceOf(ContextBusy);
  expect(await readFile(file + ".otto-context-lock", "utf8")).toBe("PEER LOCK");
});
test("global sources cannot be edited through a project graph", async () => {
  const f = await fixture();
  const file = path.join(f.home, "AGENTS.md"),
    before = "@rules.md";
  await writeFile(file, before);
  await expect(
    changeInstructionEdge({
      root: f.root,
      edge: { ...instructionReferences(before)[0]!, file },
      expectedRevision: instructionDigest(before),
      mode: "reference",
    }),
  ).rejects.toThrow("Only files in the selected workspace");
  expect(await readFile(file, "utf8")).toBe(before);
});
test("cleanup preserves both failures with the operation as cause", async () => {
  const primary = new Error("operation"),
    secondary = new Error("cleanup");
  let calls = 0;
  const result = withContextCleanup(
    async () => {
      throw primary;
    },
    async () => {
      calls++;
      throw secondary;
    },
  );
  await expect(result).rejects.toMatchObject({ errors: [primary, secondary], cause: primary });
  expect(calls).toBe(1);
});

test("import cycles are disclosed while each source is still counted once", async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, "AGENTS.md"), "ROOT\n@rules.md");
  await writeFile(path.join(f.root, "rules.md"), "RULE\n@AGENTS.md");
  const source = await InstructionSource.create({ cwd: f.root, home: f.home });
  const graph = await buildContextGraph({
    ...f,
    cwd: f.root,
    blocks: (await source.inspect()).blocks,
  });
  expect(graph.nodes).toHaveLength(2);
  expect(graph.findings).toContain(
    "Import cycle through AGENTS.md; the runtime loads each file only once.",
  );
});

test("a source edit refuses invalid UTF-8 without normalizing unrelated bytes", async () => {
  const f = await fixture(),
    file = path.join(f.root, "AGENTS.md");
  const bytes = Buffer.concat([Buffer.from("@rules.md\n"), Buffer.from([0xff])]);
  await writeFile(file, bytes);
  const text = bytes.toString("utf8");
  await expect(
    changeInstructionEdge({
      root: f.root,
      edge: { ...instructionReferences(text)[0]!, file },
      expectedRevision: instructionDigest(text),
      mode: "reference",
    }),
  ).rejects.toThrow("UTF-8");
  expect(await readFile(file)).toEqual(bytes);
  expect((await readdir(f.root)).some((name) => name.includes("otto-context"))).toBe(false);
});

test("a checkout-local dev home remains host-owned and cannot contribute editable edges", async () => {
  const f = await fixture();
  const home = path.join(f.root, ".dev", "otto-home");
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "AGENTS.md"), "HOST\n@rules.md");
  await writeFile(path.join(home, "rules.md"), "HOST_RULE");
  const source = await InstructionSource.create({ cwd: f.root, home });
  const graph = await buildContextGraph({
    root: f.root,
    home,
    cwd: f.root,
    blocks: (await source.inspect()).blocks,
  });
  expect(graph.nodes.every((node) => node.scope === "host" && !node.editable)).toBe(true);
  expect(graph.nodes.map((node) => node.label)).toContain(
    path.join("~", "AGENTS.md").replace("\\", "/"),
  );
  expect(graph.edits.size).toBe(0);
});
