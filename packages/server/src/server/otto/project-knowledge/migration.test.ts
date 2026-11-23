import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import type { KnowledgeStore } from "./store-resolver.js";
import { copyKnowledgeStore } from "./migration.js";
const parent = fileURLToPath(
  new URL("../../../../../../.tmp/knowledge-migration/", import.meta.url),
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Fixture escaped");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  roots.push(root);
  const from: KnowledgeStore = {
    projectId: "project-a",
    projectRoot: root,
    location: "repository",
    boundary: root,
    base: path.join(root, "source"),
  };
  const to: KnowledgeStore = { ...from, location: "host", base: path.join(root, "target") };
  await mkdir(path.join(from.base, "knowledge/requirements"), { recursive: true });
  const file = path.join(from.base, "knowledge/requirements/page.md");
  await writeFile(file, "Original page\r\n");
  return { root, from, to, file };
}
it("preserves policy, CRLF, unknown files and binary bytes, and keeps original files", async () => {
  const f = await fixture();
  const bytes = Buffer.from([0, 255, 128, 13, 10]);
  await writeFile(path.join(f.from.base, "KNOWLEDGE.md"), "User policy");
  await writeFile(path.join(f.from.base, "knowledge/unknown.bin"), bytes);
  let published = 0;
  expect(
    await copyKnowledgeStore({
      ...f,
      publish: async () => {
        published++;
      },
    }),
  ).toEqual({ copied: 3 });
  expect(published).toBe(1);
  expect(await readFile(f.file, "utf8")).toBe("Original page\r\n");
  expect(await readFile(path.join(f.to.base, "knowledge/unknown.bin"))).toEqual(bytes);
  expect(await readFile(path.join(f.to.base, "KNOWLEDGE.md"), "utf8")).toBe("User policy");
});
it("does not publish or overwrite a conflicting destination", async () => {
  const f = await fixture();
  await mkdir(path.join(f.to.base, "knowledge/requirements"), { recursive: true });
  const target = path.join(f.to.base, "knowledge/requirements/page.md");
  await writeFile(target, "Different destination");
  let published = false;
  await expect(
    copyKnowledgeStore({
      ...f,
      publish: async () => {
        published = true;
      },
    }),
  ).rejects.toThrow("changed");
  expect(published).toBe(false);
  expect(await readFile(target, "utf8")).toBe("Different destination");
});
it("retains complete source/copy after registry failure and resumes only over identical copies", async () => {
  const f = await fixture();
  await expect(
    copyKnowledgeStore({
      ...f,
      publish: async () => {
        throw new Error("Registry CAS failed");
      },
    }),
  ).rejects.toThrow("Registry CAS failed");
  expect(await readFile(f.file, "utf8")).toBe("Original page\r\n");
  let published = false;
  await copyKnowledgeStore({
    ...f,
    publish: async () => {
      published = true;
    },
  });
  expect(published).toBe(true);
});
it("refuses to merge an unrelated extra destination file", async () => {
  const f = await fixture();
  await mkdir(path.join(f.to.base, "knowledge"), { recursive: true });
  await writeFile(path.join(f.to.base, "knowledge/unrelated.md"), "Someone else's store");
  await expect(
    copyKnowledgeStore({
      ...f,
      publish: async () => {
        throw new Error("must not publish");
      },
    }),
  ).rejects.toThrow("changed");
});
it("refuses source links without reading or copying outside the owning boundary", async () => {
  const f = await fixture();
  const outside = path.join(f.root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "secret.md"), "Outside data");
  await symlink(
    outside,
    path.join(f.from.base, "knowledge/linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(
    copyKnowledgeStore({
      ...f,
      publish: async () => {
        throw new Error("must not publish");
      },
    }),
  ).rejects.toThrow("symbolic");
});
it("rejects overlapping stores before acquiring recursive locks", async () => {
  const f = await fixture();
  await expect(
    copyKnowledgeStore({
      ...f,
      to: { ...f.to, base: path.join(f.from.base, "nested") },
      publish: async () => {},
    }),
  ).rejects.toThrow("overlap");
});
