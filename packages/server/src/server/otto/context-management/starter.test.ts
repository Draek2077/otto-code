import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, realpath, link } from "node:fs/promises";
import { afterEach, expect, test } from "vitest";
import { inspectContextStarter, proposeStarter, saveStarter } from "./starter.js";
import type { StructuredTextGeneration } from "../../session/checkout/git-metadata-generator.js";

const parent = fileURLToPath(
  new URL("../../../../../../.tmp/context-starter-fixtures/", import.meta.url),
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw Error("Fixture escaped its owning directory");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(parent, { recursive: true });
  const root = await realpath(await mkdtemp(path.join(parent, "case-")));
  roots.push(root);
  await writeFile(path.join(root, "README.md"), "# Example\nRun only commands documented here.");
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, ".env"), "PRIVATE_FIXTURE_SECRET");
  return root;
}
function generation(text: string): StructuredTextGeneration {
  return {
    async generate(request) {
      return request.schema.parse({ text });
    },
  };
}
async function create(root: string, text = "# Project\nKeep instructions concise.") {
  const origin = await inspectContextStarter(root, "AGENTS.md");
  return saveStarter(root, {
    fileName: "AGENTS.md",
    expectedRevision: origin.revision,
    text,
    userApprovedCreate: true,
  });
}
test("inspection reads bounded root evidence, excludes secrets and writes nothing", async () => {
  const root = await fixture();
  const before = await readdir(root);
  const result = await inspectContextStarter(root, "AGENTS.md");
  expect(result.repositoryContext).toContain("src/");
  expect(result.repositoryContext).toContain("Run only commands");
  expect(result.repositoryContext).not.toContain("PRIVATE_FIXTURE_SECRET");
  expect(await readdir(root)).toEqual(before);
});
test("generation is a proposal with no file-writing port", async () => {
  const root = await fixture(),
    origin = await inspectContextStarter(root, "AGENTS.md");
  const draft = await proposeStarter(
    root,
    { ...origin, expectedRevision: origin.revision, instruction: "Use short prose" },
    generation("# Draft"),
  );
  expect(draft.text).toBe("# Draft");
  expect(await readdir(root)).not.toContain("AGENTS.md");
});
test("explicit creation publishes reviewed bytes and releases its staging file and lock", async () => {
  const root = await fixture();
  expect(await create(root)).toEqual({ created: true, fileName: "AGENTS.md" });
  expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe(
    "# Project\nKeep instructions concise.",
  );
  expect((await readdir(root)).some((name) => name.includes(".otto-context-"))).toBe(false);
});
test("an existing peer file is preserved byte for byte", async () => {
  const root = await fixture(),
    origin = await inspectContextStarter(root, "AGENTS.md");
  await writeFile(path.join(root, "AGENTS.md"), "peer bytes");
  await expect(
    saveStarter(root, {
      ...origin,
      expectedRevision: origin.revision,
      text: "draft",
      userApprovedCreate: true,
    }),
  ).rejects.toThrow("already exists");
  expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("peer bytes");
});
test("repository changes invalidate the reviewed generation and creation origin", async () => {
  const root = await fixture(),
    origin = await inspectContextStarter(root, "AGENTS.md");
  await writeFile(path.join(root, "README.md"), "changed facts");
  const input = {
    ...origin,
    expectedRevision: origin.revision,
    instruction: "",
    text: "draft",
    userApprovedCreate: true,
  };
  await expect(proposeStarter(root, input, generation("draft"))).rejects.toThrow(
    "repository context changed",
  );
  await expect(saveStarter(root, input)).rejects.toThrow("repository context changed");
});
test("missing generation and malformed model output leave files unchanged", async () => {
  const root = await fixture(),
    origin = await inspectContextStarter(root, "AGENTS.md");
  const input = { ...origin, expectedRevision: origin.revision, instruction: "" };
  await expect(proposeStarter(root, input, undefined)).rejects.toThrow("unavailable");
  await expect(proposeStarter(root, input, generation(""))).rejects.toThrow("valid starter");
  expect(await readdir(root)).not.toContain("AGENTS.md");
});
test.each(["", "\0", "é".repeat(70000)])(
  "invalid starter bytes are rejected before any write",
  async (text) => {
    const root = await fixture();
    await expect(create(root, text)).rejects.toThrow("UTF-8");
    expect((await readdir(root)).some((name) => name.includes(".otto-context-"))).toBe(false);
  },
);
test("creation requires explicit approval and never steals an existing lock", async () => {
  const root = await fixture(),
    origin = await inspectContextStarter(root, "AGENTS.md");
  await expect(
    saveStarter(root, {
      ...origin,
      expectedRevision: origin.revision,
      text: "draft",
      userApprovedCreate: false,
    }),
  ).rejects.toThrow("explicitly approve");
  await writeFile(path.join(root, "AGENTS.md.otto-context-lock"), "owner");
  await expect(create(root)).rejects.toThrow("owns this file's lock");
  expect(await readFile(path.join(root, "AGENTS.md.otto-context-lock"), "utf8")).toBe("owner");
});
test("a linked README is excluded from generation evidence", async () => {
  const root = await fixture();
  await link(path.join(root, "README.md"), path.join(root, ".private-readme-link"));
  expect(
    JSON.parse((await inspectContextStarter(root, "CLAUDE.md")).repositoryContext).readme,
  ).toBe("");
});
test("long escaped repository evidence stays within the structural response limit", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "README.md"), "\u0001".repeat(8000));
  const current = await inspectContextStarter(root, "CLAUDE.md");
  expect(current.repositoryContext.length).toBeLessThanOrEqual(24000);
});
