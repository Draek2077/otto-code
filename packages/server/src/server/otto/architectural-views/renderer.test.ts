import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ViewKind } from "@getpaseo/plugin/otto/architectural-views";
import { ARTIFACT_CSP } from "../artifacts/content.js";
import { ArchitecturalViewRenderer } from "./renderer.js";
import { viewStarter } from "./starter.js";
import { specificationText } from "./specification.js";

const fixtures = fileURLToPath(
  new URL("../../../../../../.tmp/archify-restoration/renderer-fixtures/", import.meta.url),
);
const owners: Array<{ root: string; renderer: ArchitecturalViewRenderer }> = [];
async function fixture() {
  await mkdir(fixtures, { recursive: true });
  const root = await mkdtemp(path.join(fixtures, "fixture-"));
  const renderer = new ArchitecturalViewRenderer({
    boundary: root,
    scratchRoot: path.join(root, "renders"),
  });
  owners.push({ root, renderer });
  return { root, renderer };
}
afterEach(async () => {
  for (const owner of owners.splice(0)) {
    await owner.renderer.close();
    const relative = path.relative(path.resolve(fixtures), path.resolve(owner.root));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Fixture escaped its owned root");
    await rm(owner.root, { recursive: true, force: true });
  }
});
test.each(ViewKind.options)(
  "the pinned runtime really validates/renders an offline %s View",
  async (diagramType) => {
    const f = await fixture();
    expect(f.renderer.available()).toBe(true);
    const rendered = await f.renderer.render({
      diagramType,
      specification: viewStarter(diagramType, "Knowledge source"),
      projectRoot: f.root,
    });
    expect(rendered.receipt.ok).toBe(true);
    expect(rendered.html).toContain(ARTIFACT_CSP);
    expect(rendered.html).toContain("Knowledge source");
    expect(rendered.html).toContain("Archify");
    expect(rendered.specificationSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readdir(path.join(f.root, "renders"))).toEqual([]);
  },
);
test("mismatched types and external brand requests never reach rendering", async () => {
  const f = await fixture();
  await expect(
    f.renderer.render({
      diagramType: "sequence",
      specification: viewStarter("architecture", "Wrong type"),
      projectRoot: f.root,
    }),
  ).rejects.toThrow("does not match");
  const specification = viewStarter("architecture", "Brand request");
  specification.components = [{ id: "remote", brand: "https://example.invalid/logo.svg" }];
  await expect(
    f.renderer.render({ diagramType: "architecture", specification, projectRoot: f.root }),
  ).rejects.toThrow("brand artwork");
  expect(await readdir(f.root)).toEqual([]);
});
test("structural and byte budgets reject specifications before the recursive schema/renderer", () => {
  const value: Record<string, unknown> = {};
  let cursor = value;
  for (let depth = 0; depth < 34; depth++) {
    const child = {};
    cursor.next = child;
    cursor = child;
  }
  expect(() => specificationText("architecture", value)).toThrow("structural budget");
  expect(() => specificationText("architecture", { text: "x".repeat(524288) })).toThrow("512 KiB");
});
test("closed or already canceled rendering never launches a child", async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    f.renderer.render({
      diagramType: "architecture",
      specification: viewStarter("architecture", "Canceled"),
      projectRoot: f.root,
      signal: controller.signal,
    }),
  ).rejects.toThrow("canceled");
  expect(await readdir(path.join(f.root, "renders"))).toEqual([]);
  await f.renderer.close();
  expect(f.renderer.available()).toBe(false);
  await expect(
    f.renderer.render({ diagramType: "architecture", specification: {}, projectRoot: f.root }),
  ).rejects.toThrow("shutting down");
});
