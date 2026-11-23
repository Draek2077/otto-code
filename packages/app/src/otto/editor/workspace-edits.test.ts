import { expect, it } from "vitest";
import { EditorWorkspaceEdits } from "./workspace-edits";
import type { EditorRpc } from "./client";
import {
  searchEditorFiles,
  planEditorReplace,
  applyEditorRename,
} from "@getpaseo/plugin/otto/editor";
const options = {
  query: "count",
  caseSensitive: false,
  wholeWord: true,
  regexp: false,
  include: "*.ts",
  exclude: "",
};
const search = {
  searchId: "search",
  scannedFiles: 1,
  truncated: false,
  matches: [
    { file: "/workspace/file.ts", line: 1, column: 7, length: 5, preview: "const count = 1;" },
  ],
};
function client(route: (method: string) => Promise<unknown>): EditorRpc {
  return {
    hostId: "host",
    async call(contract) {
      return contract.output.parse(await route(contract.name));
    },
  };
}
function model() {
  return new EditorWorkspaceEdits({
    hostId: "host",
    root: "/workspace",
    close() {},
    navigate() {},
  });
}
it("searches without a synthetic document and rejects stale replies across host visibility changes", async () => {
  let accept: (value: unknown) => void = () => {};
  const pending = new Promise((resolve) => {
    accept = resolve;
  });
  const view = model();
  view.connect(client(async () => pending));
  const running = view.searchFiles(options);
  view.connect(null);
  accept(search);
  await running;
  expect(view.getSnapshot().search).toBeNull();
  view.connect(client(async () => search));
  await view.searchFiles(options);
  expect(view.getSnapshot().search?.matches).toHaveLength(1);
});
it("serializes reviewed writes, retains failed drafts and invalidates a hidden operation's UI authority", async () => {
  let accept: (value: unknown) => void = () => {};
  const pending = new Promise((resolve) => {
    accept = resolve;
  });
  let writes = 0;
  const view = model();
  view.connect(
    client(async (method) => {
      if (method === searchEditorFiles.name) return search;
      if (method === planEditorReplace.name)
        return {
          planId: "plan",
          root: "/workspace",
          files: [{ file: "/workspace/file.ts", before: "count", after: "total", editCount: 1 }],
        };
      if (method === applyEditorRename.name) {
        writes++;
        return pending;
      }
      throw new Error("Unexpected method");
    }),
  );
  await view.searchFiles(options);
  await view.planReplace("total", ["/workspace/file.ts"]);
  const applying = view.applyRename();
  await view.applyRename();
  expect(writes).toBe(1);
  view.connect(null);
  accept({
    runId: "run",
    files: [{ file: "/workspace/file.ts", state: "applied", message: null }],
  });
  await applying;
  expect(view.getSnapshot()).toMatchObject({ panel: "none", plan: null, outcome: null });
  expect(view.getSnapshot().error).toContain("still running");
});
