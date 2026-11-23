import { expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EditorExports } from "./exports.js";
it("creates idempotent exports beside the owning source without overwriting an existing file or the source", async () => {
  const base = path.resolve("../../.tmp/editor-export-fixtures");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "root-")),
    file = path.join(root, "guide.md");
  const exports = new EditorExports();
  try {
    await writeFile(file, "# Unsaved source is not written by exporting\n");
    await writeFile(path.join(root, "guide.html"), "An existing user's document");
    const request = {
      hostId: "host",
      root,
      file,
      operationId: randomUUID(),
      extension: "html" as const,
      base64: Buffer.from("<!doctype html><h1>Exported café</h1>").toString("base64"),
    };
    const output = await exports.write("client", request, () => true);
    expect(output.file).toBe(path.join(root, "guide-2.html"));
    expect(await exports.write("client", request, () => true)).toEqual(output);
    expect(await readFile(output.file, "utf8")).toContain("café");
    expect(await readFile(path.join(root, "guide.html"), "utf8")).toBe(
      "An existing user's document",
    );
    expect(await readFile(file, "utf8")).toContain("Unsaved source");
    expect(() =>
      exports.write(
        "client",
        { ...request, base64: Buffer.from("changed").toString("base64") },
        () => true,
      ),
    ).toThrow("identity");
    await expect(
      exports.write(
        "client",
        { ...request, operationId: randomUUID(), extension: "pdf" },
        () => true,
      ),
    ).rejects.toThrow("PDF");
    await expect(
      exports.write("client", { ...request, operationId: randomUUID() }, () => false),
    ).rejects.toThrow("canceled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
