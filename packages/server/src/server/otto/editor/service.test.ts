import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import {
  queryEditor,
  queryBoundEditor,
  observeEditor,
  releaseEditor,
  listEditorServers,
  readEditorSettings,
  saveEditorSettings,
  planEditorRename,
  applyEditorRename,
  undoEditorRename,
  EditorQueryResult,
  EditorObservation,
  EditorPlan,
  EditorEditOutcome,
} from "@getpaseo/plugin/otto/editor";
import { EditorHost } from "./service.js";

async function fixture() {
  const directory = path.resolve("../../.tmp/editor-host-fixtures");
  await mkdir(directory, { recursive: true });
  const root = await mkdtemp(path.join(directory, "workspace-"));
  const home = path.join(root, "home");
  await mkdir(home);
  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include: ["*.ts"] }),
  );
  const file = path.join(root, "example.ts");
  const text =
    "export const answer: number = 42;\nconst value: string = answer;\nconsole.log(answer);\n";
  await writeFile(file, text);
  const host = new EditorHost(home, () => "host", pino({ level: "silent" }));
  const document = {
    hostId: "host",
    root,
    file,
    text,
    documentId: "editor",
    draftVersion: 0,
    modified: false,
  };
  return { host, home, document, root };
}

describe("owning host editor bridge with bundled TypeScript server", () => {
  it("lazily supplies real definitions, hover, references, completion, outline and diagnostics, then stops on disable", async () => {
    const f = await fixture();
    const { document, host } = f;
    const ask = async (action: EditorQueryResult["action"], line: number, character: number) =>
      EditorQueryResult.parse(
        await host.invoke(
          queryEditor.name,
          { ...document, action, position: { line, character } },
          "client",
        ),
      );
    try {
      expect(
        await host.invoke(listEditorServers.name, { hostId: "host", root: null }, "client"),
      ).toMatchObject({ running: [] });
      expect(await ask("definition", 2, 15)).toMatchObject({
        state: "ready",
        locations: [{ file: document.file, range: { start: { line: 0, character: 13 } } }],
      });
      expect((await ask("hover", 2, 15)).hover).toContain("number");
      const bound = {
        hostId: "host",
        documentId: "editor",
        draftVersion: 0,
        modified: false,
        action: "hover",
        position: { line: 2, character: 15 },
      };
      expect(await host.invoke(queryBoundEditor.name, bound, "client")).toMatchObject({
        state: "ready",
        result: { state: "ready", hover: expect.stringContaining("number") },
      });
      expect(await host.invoke(queryBoundEditor.name, bound, "another-client")).toEqual({
        state: "needsSync",
      });
      expect(
        await host.invoke(queryBoundEditor.name, { ...bound, draftVersion: 1 }, "client"),
      ).toEqual({ state: "needsSync" });
      expect((await ask("references", 0, 14)).locations).toHaveLength(3);
      expect((await ask("symbols", 0, 0)).symbols.map((symbol) => symbol.name)).toContain("answer");
      expect((await ask("completion", 2, 16)).completions.map((item) => item.label)).toContain(
        "answer",
      );
      expect(await ask("definition", 0, 1)).toMatchObject({
        source: "language-server",
        state: "ready",
        locations: [],
      });
      let snapshot = EditorObservation.parse(
        await host.invoke(
          observeEditor.name,
          { hostId: "host", documentId: "editor", cursor: null },
          "client",
        ),
      );
      for (let attempt = 0; !snapshot.diagnostics.length && attempt < 3; attempt++) {
        snapshot = EditorObservation.parse(
          await host.invoke(
            observeEditor.name,
            { hostId: "host", documentId: "editor", cursor: snapshot.cursor },
            "client",
          ),
        );
      }
      expect(
        snapshot.diagnostics.some((diagnostic) => diagnostic.message.includes("not assignable")),
      ).toBe(true);
      const settings = readEditorSettings.output.parse(
        await host.invoke(readEditorSettings.name, { hostId: "host" }, "client"),
      );
      await host.invoke(
        saveEditorSettings.name,
        { hostId: "host", expectedRevision: settings.revision, patch: { enabled: false } },
        "client",
      );
      expect(
        await host.invoke(listEditorServers.name, { hostId: "host", root: null }, "client"),
      ).toMatchObject({ running: [] });
      await host.invoke(releaseEditor.name, { hostId: "host", documentId: "editor" }, "client");
      expect(await host.invoke(queryBoundEditor.name, bound, "client")).toEqual({
        state: "needsSync",
      });
    } finally {
      await host.close();
      await rm(f.root, { recursive: true, force: true });
    }
  }, 60000);

  it("reviews real TypeScript rename, applies only the reviewed plan and safely undoes it", async () => {
    const f = await fixture();
    try {
      const plan = EditorPlan.parse(
        await f.host.invoke(
          planEditorRename.name,
          { ...f.document, position: { line: 0, character: 14 }, newName: "result" },
          "client",
        ),
      );
      expect(plan.files).toHaveLength(1);
      expect(plan.files[0].editCount).toBe(3);
      const applied = EditorEditOutcome.parse(
        await f.host.invoke(
          applyEditorRename.name,
          { hostId: "host", planId: plan.planId },
          "client",
        ),
      );
      expect(applied.files[0].state).toBe("applied");
      // A stale retained editor draft must not be overwritten by undo.
      await f.host.releaseClient("client");
      const undone = EditorEditOutcome.parse(
        await f.host.invoke(
          undoEditorRename.name,
          { hostId: "host", runId: applied.runId },
          "client",
        ),
      );
      expect(undone.files[0].state).toBe("restored");
    } finally {
      await f.host.close();
      await rm(f.root, { recursive: true, force: true });
    }
  }, 60000);
});
