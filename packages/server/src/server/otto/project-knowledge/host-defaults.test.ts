import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { KnowledgeHostDefaultsStore } from "./host-defaults.js";

const parent = fileURLToPath(
  new URL("../../../../../../.tmp/knowledge-host-defaults/", import.meta.url),
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
  const home = await mkdtemp(path.join(parent, "case-"));
  roots.push(home);
  return {
    home,
    store: new KnowledgeHostDefaultsStore(home),
    file: path.join(home, "project-knowledge/settings.json"),
    legacy: path.join(home, "otto-config.json"),
  };
}
it("reads retained defaults without initializing or rewriting the original Otto document", async () => {
  const f = await fixture();
  expect(await f.store.read()).toMatchObject({ defaultStoreLocation: "repository" });
  expect(await readdir(f.home)).toEqual([]);
  const raw = JSON.stringify({
    projectKnowledge: { defaultStoreLocation: "host", future: true },
    brain: { enabled: true, remote: { authToken: "not-returned" } },
    providers: { retained: true },
  });
  await writeFile(f.legacy, raw);
  const read = await f.store.read();
  expect(read.defaultStoreLocation).toBe("host");
  expect(JSON.stringify(read)).not.toContain("not-returned");
  await f.store.save({ expectedRevision: read.revision, defaultStoreLocation: "repository" });
  expect(await readFile(f.legacy, "utf8")).toBe(raw);
  expect(await f.store.read()).toMatchObject({ defaultStoreLocation: "repository" });
});
it("preserves unknown preference fields and refuses stale cooperating writers", async () => {
  const f = await fixture();
  await mkdir(path.dirname(f.file));
  await writeFile(
    f.file,
    JSON.stringify({ version: 1, defaultStoreLocation: "repository", future: { retained: true } }),
  );
  const origin = await f.store.read();
  const peer = new KnowledgeHostDefaultsStore(f.home);
  const outcomes = await Promise.allSettled([
    f.store.save({ expectedRevision: origin.revision, defaultStoreLocation: "host" }),
    peer.save({ expectedRevision: origin.revision, defaultStoreLocation: "repository" }),
  ]);
  expect(outcomes.map((item) => item.status)).toEqual(["fulfilled", "rejected"]);
  expect(JSON.parse(await readFile(f.file, "utf8"))).toMatchObject({
    defaultStoreLocation: "host",
    future: { retained: true },
  });
});
it("publishes only after preservation completes and retains the old default if preparation fails", async () => {
  const f = await fixture();
  const origin = await f.store.read();
  await expect(
    f.store.save({
      expectedRevision: origin.revision,
      defaultStoreLocation: "host",
      preserveAndPublish: async () => {
        expect(await readdir(f.home)).toEqual([]);
        throw new Error("Preservation did not finish");
      },
    }),
  ).rejects.toThrow("Preservation");
  expect(await readdir(f.home)).toEqual([]);
  expect(await f.store.read()).toEqual(origin);
});
it("does not overwrite an external settings or retained-document edit observed during preparation", async () => {
  const f = await fixture();
  await writeFile(
    f.legacy,
    JSON.stringify({ projectKnowledge: { defaultStoreLocation: "repository" } }),
  );
  const origin = await f.store.read();
  const peer = JSON.stringify({
    projectKnowledge: { defaultStoreLocation: "host" },
    preserved: true,
  });
  await expect(
    f.store.save({
      expectedRevision: origin.revision,
      defaultStoreLocation: "host",
      preserveAndPublish: async ({ publish }) => {
        await writeFile(f.legacy, peer);
        return publish();
      },
    }),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(await readFile(f.legacy, "utf8")).toBe(peer);
  await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
});
it("preserves corrupt data and never substitutes the repository default for unreadable retained intent", async () => {
  const f = await fixture();
  await writeFile(f.legacy, "invalid original");
  await expect(f.store.read()).rejects.toMatchObject({ kind: "unavailable" });
  expect(await readFile(f.legacy, "utf8")).toBe("invalid original");
  await mkdir(path.dirname(f.file));
  await writeFile(f.file, "invalid preference");
  await expect(f.store.read()).rejects.toMatchObject({ kind: "unavailable" });
  expect(await readFile(f.file, "utf8")).toBe("invalid preference");
});
