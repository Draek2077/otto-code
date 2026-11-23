import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { EditorRenames, applyTextEdits } from "./rename.js";
import { fileUri } from "./lsp/uri.js";
import { writeExplorerFile } from "../../file-explorer/service.js";

describe("reviewed editor rename safety", () => {
  it("retains undo when a write committed but reported a cleanup failure", async () => {
    const base = path.resolve("../../.tmp/editor-rename-fixtures");
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(path.join(base, "outcome-"));
    const file = path.join(root, "example.ts"),
      text = "const old = 1;\n";
    let first = true;
    const renames = new EditorRenames(
      () => [],
      async (input) => {
        const result = await writeExplorerFile(input);
        if (first) {
          first = false;
          return { status: "error", error: "Injected post-commit cleanup failure" };
        }
        return result;
      },
    );
    try {
      await writeFile(file, text);
      const plan = await renames.plan({
        clientId: "client",
        root,
        origin: { file, text },
        value: {
          changes: {
            [fileUri(file)]: [
              {
                range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
                newText: "fresh",
              },
            ],
          },
        },
      });
      const applied = await renames.apply("client", plan.planId);
      expect(applied.files[0]).toMatchObject({
        state: "applied",
        message: expect.stringContaining("post-commit cleanup failure"),
      });
      expect(await readFile(file, "utf8")).toBe("const fresh = 1;\n");
      expect((await renames.undo("client", applied.runId)).files[0].state).toBe("restored");
      expect(await readFile(file, "utf8")).toBe(text);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each(["\n", "\r", "\r\n"])(
    "preserves line separator %j during multi-line edits",
    (separator) => {
      expect(
        applyTextEdits(`first${separator}old${separator}last`, [
          {
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
            newText: "new",
          },
        ]),
      ).toBe(`first${separator}new${separator}last`);
    },
  );
  it("uses UTF-16 source positions and preserves CRLF", () => {
    const text = "// 😀\r\nconst oldName = 1;\r\n";
    expect(
      applyTextEdits(text, [
        {
          range: { start: { line: 1, character: 6 }, end: { line: 1, character: 13 } },
          newText: "newName",
        },
      ]),
    ).toBe("// 😀\r\nconst newName = 1;\r\n");
    expect(() =>
      applyTextEdits("abc", [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
          newText: "x",
        },
        {
          range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
          newText: "y",
        },
      ]),
    ).toThrow("overlapping");
  });
  it("refuses changed files, preserves a BOM and never undoes a peer edit", async () => {
    const base = path.resolve("../../.tmp/editor-rename-fixtures");
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(path.join(base, "workspace-"));
    const file = path.join(root, "example.ts");
    const text = "const value = 1;\n";
    const edit = {
      changes: {
        [fileUri(file)]: [
          {
            range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
            newText: "answer",
          },
        ],
      },
    };
    const renames = new EditorRenames(() => []);
    try {
      await writeFile(file, "\uFEFF" + text);
      const plan = await renames.plan({
        clientId: "client",
        root,
        value: edit,
        origin: { file, text },
      });
      expect(plan.files[0].after).toBe("\uFEFFconst answer = 1;\n");
      await writeFile(file, "peer edit");
      expect((await renames.apply("client", plan.planId)).files[0].state).toBe("conflict");
      expect(await readFile(file, "utf8")).toBe("peer edit");
      await writeFile(file, "\uFEFF" + text);
      const fresh = await renames.plan({
        clientId: "client",
        root,
        value: edit,
        origin: { file, text },
      });
      const applied = await renames.apply("client", fresh.planId);
      expect(applied.files[0].state).toBe("applied");
      await writeFile(file, "newer peer edit");
      expect((await renames.undo("client", applied.runId)).files[0].state).toBe("conflict");
      expect(await readFile(file, "utf8")).toBe("newer peer edit");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
