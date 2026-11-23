import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, link } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  previewCommandRevision,
  previewDestination,
  readPreviewLaunchConfig,
} from "./launch-config.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const server = { name: "web", runtimeExecutable: "npm", runtimeArgs: ["run", "dev"], port: 8200 };
async function fixture(value?: unknown) {
  const root = await mkdtemp(path.join(os.tmpdir(), "otto-preview-config-"));
  roots.push(root);
  const directory = path.join(root, ".claude");
  const file = path.join(directory, "launch.json");
  if (value !== undefined) {
    await mkdir(directory);
    await writeFile(file, JSON.stringify(value));
  }
  return { root, file };
}
test("missing configuration stays unconfigured without creating files", async () => {
  const f = await fixture();
  expect(await readPreviewLaunchConfig(f.root)).toBeNull();
  await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
});
test("only the selected workspace launch file is read, preserving unknown fields and bytes", async () => {
  const f = await fixture({
    version: "0.0.1",
    configurations: [{ ...server, future: true }],
    future: true,
  });
  const original = await readFile(f.file);
  const config = await readPreviewLaunchConfig(f.root);
  expect(config?.servers).toEqual([server]);
  expect(config?.revision).toMatch(/^[0-9a-f]{64}$/);
  expect(await readFile(f.file)).toEqual(original);
  const nested = path.join(f.root, "nested");
  await mkdir(nested);
  expect(await readPreviewLaunchConfig(nested)).toBeNull();
});
test.each([
  { configurations: [{ ...server, port: 0 }] },
  { configurations: [{ ...server, url: "file:///tmp/page" }] },
  { configurations: [{ ...server, url: "https://user:secret@example.com" }] },
  { configurations: [{ ...server, runtimeArgs: ["bad\0argument"] }] },
  { configurations: [{ ...server, env: { "BAD=NAME": "value" } }] },
  { configurations: [server, server] },
])("invalid launch configuration is refused without changing bytes %#", async (value) => {
  const f = await fixture(value);
  const before = await readFile(f.file);
  await expect(readPreviewLaunchConfig(f.root)).rejects.toThrow("launch");
  expect(await readFile(f.file)).toEqual(before);
});
test("malformed, invalid UTF-8 and oversized documents stay intact", async () => {
  const f = await fixture({ configurations: [] });
  for (const bytes of [Buffer.from("{bad"), Buffer.from([255]), Buffer.alloc(256 * 1024 + 1, 32)]) {
    await writeFile(f.file, bytes);
    await expect(readPreviewLaunchConfig(f.root)).rejects.toThrow("launch");
    expect(await readFile(f.file)).toEqual(bytes);
  }
});
test("hard-linked configurations are not accepted as workspace execution authority", async () => {
  const f = await fixture({ configurations: [server] });
  await link(f.file, path.join(f.root, "linked.json"));
  await expect(readPreviewLaunchConfig(f.root)).rejects.toThrow("ordinary launch file");
});
test("browser URL is independent of the local readiness port", () => {
  expect(previewDestination(server)).toBe("http://127.0.0.1:8200/");
  expect(previewDestination({ ...server, url: "https://preview.example/app?q=1#top" })).toBe(
    "https://preview.example/app?q=1#top",
  );
});
test("approval identity binds cwd, executable, argv and environment, not URL or key order", () => {
  const baseline = previewCommandRevision("/workspace", { ...server, env: { B: "2", A: "1" } });
  expect(
    previewCommandRevision("/workspace", {
      ...server,
      name: "renamed",
      url: "https://example.com",
      env: { A: "1", B: "2" },
    }),
  ).toBe(baseline);
  for (const changed of [
    { ...server, runtimeExecutable: "python" },
    { ...server, runtimeArgs: ["run", "other"] },
    { ...server, env: { A: "other" } },
  ])
    expect(previewCommandRevision("/workspace", changed)).not.toBe(baseline);
  expect(previewCommandRevision("/other", { ...server, env: { B: "2", A: "1" } })).not.toBe(
    baseline,
  );
});
