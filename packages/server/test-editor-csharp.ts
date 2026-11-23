import { expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import {
  queryEditor,
  EditorQueryResult,
  observeEditor,
  EditorObservation,
} from "@getpaseo/plugin/otto/editor";
import { EditorHost } from "./src/server/otto/editor/service.js";

// CI installs csharp-ls and its SDK into the disposable job. Developer machines
// are never changed by a test, and absence is not represented as semantic proof.
it("uses the real C# language server for solution navigation, hover and diagnostics", async () => {
  const base = path.resolve("../../.tmp/editor-csharp-fixtures");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "project-"));
  const file = path.join(root, "Widget.cs");
  const text =
    "class Widget {\n  static int Double(int value) => value * 2;\n  static void Main() { string result = Double(2); }\n}\n";
  await writeFile(file, text);
  await writeFile(
    path.join(root, "Widget.csproj"),
    '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
  );
  const host = new EditorHost(path.join(root, "home"), () => "host", pino({ level: "silent" }));
  const document = {
    hostId: "host",
    root,
    file,
    text,
    documentId: "csharp",
    draftVersion: 0,
    modified: false,
  };
  const query = async (action: EditorQueryResult["action"]) =>
    EditorQueryResult.parse(
      await host.invoke(
        queryEditor.name,
        { ...document, action, position: { line: 2, character: 40 } },
        "client",
      ),
    );
  try {
    await expect
      .poll(async () => (await query("definition")).locations, { timeout: 90000, interval: 500 })
      .toMatchObject([{ file, range: { start: { line: 1 } } }]);
    expect((await query("hover")).hover).toContain("Double");
    let observation = EditorObservation.parse(
      await host.invoke(
        observeEditor.name,
        { hostId: "host", documentId: "csharp", cursor: null },
        "client",
      ),
    );
    for (let turn = 0; !observation.diagnostics.length && turn < 4; turn++)
      observation = EditorObservation.parse(
        await host.invoke(
          observeEditor.name,
          { hostId: "host", documentId: "csharp", cursor: observation.cursor },
          "client",
        ),
      );
    expect(
      observation.diagnostics.some((value) => /int.*string|string.*int/su.test(value.message)),
    ).toBe(true);
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
}, 150000);
