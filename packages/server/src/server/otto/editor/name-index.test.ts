import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { EditorNameIndex } from "./name-index.js";
import type { EditorDocument } from "@getpaseo/plugin/otto/editor";

describe("bounded name-only editor navigation", () => {
  it("indexes actual source, overlays the current draft, and invalidates changed disk records", async () => {
    const base = path.resolve("../../.tmp/editor-index-fixtures");
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(path.join(base, "project-"));
    const index = new EditorNameIndex();
    const file = path.join(root, "main.ts");
    const other = path.join(root, "other.ts");
    const document: EditorDocument = {
      hostId: "host",
      root,
      file,
      text: "function newest() {}\nnewest();",
      documentId: "editor",
      draftVersion: 1,
      modified: true,
    };
    try {
      await writeFile(file, "function stale() {}\n");
      await writeFile(other, "export class SharedWidget {}\n");
      await mkdir(path.join(root, "node_modules"));
      await writeFile(path.join(root, "node_modules", "hidden.ts"), "class SharedHidden {}\n");
      const outline = index.outline(document);
      expect(outline).toMatchObject({ source: "name-index", state: "ready" });
      expect(outline.symbols.map((item) => item.name)).toContain("newest");
      expect((await index.find(document, { line: 1, character: 3 })).locations).toEqual([
        { file, range: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } } },
      ]);
      const found = await index.find(document, { line: 0, character: 0 }, "Shared");
      expect(found.locations.map((item) => item.file)).toEqual([other]);
      expect((await index.find(document, { line: 0, character: 0 }, "stale")).locations).toEqual(
        [],
      );
      await writeFile(other, "export class UpdatedWidget {}\n");
      index.invalidate(root);
      expect(
        (await index.find(document, { line: 0, character: 0 }, "Updated")).locations,
      ).toHaveLength(1);
      index.release(root);
    } finally {
      index.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
