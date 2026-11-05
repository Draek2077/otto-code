import { afterEach, describe, expect, it, vi } from "vitest";
import {
  queryEditor,
  queryBoundEditor,
  planEditorRename,
  applyEditorRename,
  releaseEditor,
  observeEditor,
  type EditorQueryResult,
  type EditorEditOutcome,
} from "@getpaseo/plugin/otto/editor";
import { FileEditorModel } from "@/file-pane/editor/model";
import { EditorSurface } from "./surface";
import type { EditorRpc } from "./client";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function result(action: EditorQueryResult["action"]): EditorQueryResult {
  return {
    action,
    state: "ready",
    message: null,
    locations: [],
    hover: null,
    completions: [],
    symbols: [],
  };
}
function fixture(route: (method: string, input: unknown) => Promise<unknown>) {
  vi.useFakeTimers();
  const model = new FileEditorModel({
    file: {
      content: "const value = 1;",
      hasBom: false,
      version: {
        status: "ready",
        cwd: "/workspace",
        path: "file.ts",
        size: 16,
        modifiedAt: "initial",
        revision: "origin",
      },
    },
    session: {
      write: async (input) => ({
        status: "written",
        modifiedAt: "saved",
        revision: "saved",
        size: input.content.length,
      }),
    },
  });
  const navigate = vi.fn();
  const surface = new EditorSurface({
    hostId: "host",
    model,
    root: "/workspace",
    file: "/workspace/file.ts",
    documentId: "editor",
    navigate,
  });
  const client: EditorRpc = {
    hostId: "host",
    async call(contract, input) {
      return contract.output.parse(await route(contract.name, contract.input.parse(input)));
    },
  };
  const close = surface.activate(client);
  return { model, surface, close, navigate, client };
}
afterEach(() => vi.useRealTimers());

describe("editor presentation lifecycle", () => {
  it("keeps unsupported background diagnostics quiet while showing an explicit failed action", async () => {
    const f = fixture(async (method, input) => {
      if (method === queryBoundEditor.name) return { state: "needsSync" };
      if (method !== queryEditor.name) return { released: true };
      const request = queryEditor.input.parse(input);
      return {
        ...result(request.action),
        state: "unavailable",
        message: "No server supports this language.",
      };
    });
    try {
      await vi.advanceTimersByTimeAsync(250);
      expect(f.surface.getSnapshot()).toMatchObject({
        error: null,
        diagnosticMessage: "No server supports this language.",
      });
      await f.surface.run("definition");
      expect(f.surface.getSnapshot().error).toBe("No server supports this language.");
    } finally {
      f.close();
      f.model.dispose();
    }
  });
  it("sends unchanged source once and resynchronizes an expired lease only with the still-current draft", async () => {
    let full = 0,
      bound = 0;
    const f = fixture(async (method, input) => {
      if (method === queryEditor.name) {
        full++;
        return result(queryEditor.input.parse(input).action);
      }
      if (method === queryBoundEditor.name) {
        bound++;
        expect(input).not.toHaveProperty("text");
        if (bound === 2) return { state: "needsSync" };
        return { state: "ready", result: result(queryBoundEditor.input.parse(input).action) };
      }
      return { released: true };
    });
    try {
      await f.surface.request("hover");
      await f.surface.request("completion");
      await f.surface.request("hover");
      expect({ full, bound }).toEqual({ full: 2, bound: 2 });
      f.model.edit("new draft");
      await f.surface.request("completion");
      expect({ full, bound }).toEqual({ full: 3, bound: 2 });
    } finally {
      f.close();
      f.model.dispose();
    }
  });
  it("ignores a definition reply for text that has since changed", async () => {
    const pending = deferred<EditorQueryResult>();
    const f = fixture((method) =>
      method === queryEditor.name ? pending.promise : Promise.resolve({ released: true }),
    );
    try {
      const action = f.surface.run("definition");
      f.model.edit("new draft");
      pending.resolve({
        ...result("definition"),
        locations: [
          {
            file: "/workspace/other.ts",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          },
        ],
      });
      await action;
      expect(f.navigate).not.toHaveBeenCalled();
      expect(f.model.getSnapshot().content).toBe("new draft");
    } finally {
      f.close();
      f.model.dispose();
    }
  });
  it("does not reload over a newer edit or adopt a hidden rename acknowledgment", async () => {
    const pending = deferred<EditorEditOutcome>();
    const f = fixture(async (method) => {
      if (method === planEditorRename.name)
        return {
          planId: "plan",
          root: "/workspace",
          files: [
            {
              file: "/workspace/file.ts",
              before: "const value = 1;",
              after: "const answer = 1;",
              editCount: 1,
            },
          ],
        };
      if (method === applyEditorRename.name) return pending.promise;
      if (method === queryEditor.name) return result("diagnostics");
      return { released: true };
    });
    try {
      await f.surface.planRename("answer");
      const apply = f.surface.applyRename();
      f.model.edit("a newer local draft");
      f.close();
      pending.resolve({
        runId: "run",
        files: [{ file: "/workspace/file.ts", state: "applied", message: null }],
      });
      await apply;
      expect(f.model.getSnapshot()).toMatchObject({
        content: "a newer local draft",
        modified: true,
      });
      expect(f.surface.getSnapshot()).toMatchObject({ plan: null, outcome: null, busy: false });
    } finally {
      f.model.dispose();
    }
  });
  it("uses different observation identities after hide/reveal so old cleanup cannot release fresh demand", async () => {
    const ids: string[] = [],
      released: string[] = [];
    const waits = new Map<string, ReturnType<typeof deferred<unknown>>>();
    const f = fixture(async (method, input) => {
      if (method === queryEditor.name) return result("diagnostics");
      if (method === observeEditor.name) {
        const request = observeEditor.input.parse(input);
        ids.push(request.documentId);
        const wait = deferred<unknown>();
        waits.set(request.documentId, wait);
        return wait.promise;
      }
      const request = releaseEditor.input.parse(input);
      released.push(request.documentId);
      waits
        .get(request.documentId)
        ?.resolve({ cursor: "done", draftVersion: 0, diagnostics: [], servers: [] });
      return { released: true };
    });
    try {
      await vi.advanceTimersByTimeAsync(250);
      expect(ids).toHaveLength(1);
      f.close();
      const closeAgain = f.surface.activate(f.client);
      await vi.advanceTimersByTimeAsync(250);
      expect(ids).toHaveLength(2);
      expect(ids[1]).not.toBe(ids[0]);
      expect(released).toEqual([ids[0]]);
      closeAgain();
    } finally {
      f.model.dispose();
    }
  });
});
