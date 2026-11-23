import { expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import {
  queryEditor,
  observeEditor,
  EditorQueryResult,
  EditorObservation,
} from "@getpaseo/plugin/otto/editor";
import { EditorHost } from "./service.js";
it("uses the bundled Python server for real semantic navigation and type diagnostics", async () => {
  const base = path.resolve("../../.tmp/editor-python-fixtures");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "workspace-"));
  const file = path.join(root, "main.py");
  const text = "def double(value: int) -> int:\n    return value * 2\n\nresult: str = double(2)\n";
  await writeFile(file, text);
  await writeFile(
    path.join(root, "pyrightconfig.json"),
    JSON.stringify({ include: ["main.py"], typeCheckingMode: "strict" }),
  );
  const host = new EditorHost(path.join(root, "home"), () => "host", pino({ level: "silent" }));
  const document = {
    hostId: "host",
    root,
    file,
    text,
    documentId: "python",
    draftVersion: 0,
    modified: false,
  };
  const query = async (action: EditorQueryResult["action"], line: number, character: number) =>
    EditorQueryResult.parse(
      await host.invoke(
        queryEditor.name,
        { ...document, action, position: { line, character } },
        "client",
      ),
    );
  try {
    expect(await query("definition", 3, 16)).toMatchObject({
      state: "ready",
      source: "language-server",
      locations: [{ file, range: { start: { line: 0, character: 4 } } }],
    });
    expect((await query("hover", 3, 16)).hover).toContain("double");
    expect((await query("references", 0, 6)).locations).toHaveLength(2);
    expect((await query("symbols", 0, 0)).symbols.map((symbol) => symbol.name)).toContain("double");
    let observed = EditorObservation.parse(
      await host.invoke(
        observeEditor.name,
        { hostId: "host", documentId: "python", cursor: null },
        "client",
      ),
    );
    for (let count = 0; !observed.diagnostics.length && count < 3; count++)
      observed = EditorObservation.parse(
        await host.invoke(
          observeEditor.name,
          { hostId: "host", documentId: "python", cursor: observed.cursor },
          "client",
        ),
      );
    expect(observed.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toMatch(
      /int.*str|str.*int/su,
    );
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
