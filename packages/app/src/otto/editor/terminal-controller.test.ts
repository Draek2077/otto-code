import { describe, expect, it, vi } from "vitest";
import {
  openTerminalEditor,
  findTerminalEditor,
  closeTerminalEditor,
  type TerminalEditorSession,
} from "@getpaseo/plugin/otto/editor";
import { FileTerminalController } from "./terminal-controller";
import { editorPreferenceDefaults } from "./preferences";
import type { EditorRpc } from "./client";

const scope = { hostId: "host", workspaceId: "workspace", file: "/workspace/file.ts" };
const session: TerminalEditorSession = {
  workspaceId: scope.workspaceId,
  file: scope.file,
  cwd: "/workspace",
  terminalId: "otto-editor:incarnation",
  mode: "vim",
};
function fixture(route: (method: string) => Promise<unknown>) {
  const rpc: EditorRpc = {
    hostId: "host",
    async call(contract, input) {
      contract.input.parse(input);
      return contract.output.parse(await route(contract.name));
    },
  };
  const model = new FileTerminalController(
    scope,
    { ...editorPreferenceDefaults, fileEditorMode: "vim" },
    4,
  );
  model.connect(rpc);
  return { model, rpc };
}
describe("file-owned terminal lifecycle", () => {
  it("resolves an uncertain admitted launch before allowing close and confirms the recovered buffer", async () => {
    let finds = 0;
    const f = fixture(async (method) => {
      if (method === findTerminalEditor.name) return ++finds === 1 ? null : session;
      if (method === openTerminalEditor.name) throw new Error("transport lost after admission");
      return { closed: true };
    });
    await f.model.open();
    expect(f.model.hasUncertainLaunch).toBe(true);
    const confirm = vi.fn(async () => false);
    expect(await f.model.stop(confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(f.model.getSnapshot().session).toEqual(session);
    expect(await f.model.stop(async () => true)).toBe(true);
  });
  it("adopts an existing session and refuses to close a declined or disconnected buffer", async () => {
    const calls: string[] = [];
    const f = fixture(async (method) => {
      calls.push(method);
      return method === closeTerminalEditor.name ? { closed: true } : session;
    });
    await f.model.open();
    expect(calls).toEqual([findTerminalEditor.name]);
    expect(await f.model.stop(async () => false)).toBe(false);
    f.model.connect(null);
    expect(await f.model.stop(async () => true)).toBe(false);
    expect(f.model.getSnapshot().session).toEqual(session);
    f.model.connect(f.rpc);
    expect(await f.model.stop(async () => true)).toBe(true);
    expect(calls).toEqual([findTerminalEditor.name, closeTerminalEditor.name]);
  });
  it("waits for an admitted open before confirmed close, with one open and stop", async () => {
    let accept: ((value: TerminalEditorSession) => void) | undefined;
    const opening = new Promise<TerminalEditorSession>((resolve) => {
      accept = resolve;
    });
    const calls: string[] = [];
    const f = fixture(async (method) => {
      calls.push(method);
      if (method === findTerminalEditor.name) return null;
      if (method === openTerminalEditor.name) return opening;
      return { closed: true };
    });
    const first = f.model.open();
    expect(f.model.open()).toBe(first);
    const confirm = vi.fn(async () => true);
    const closing = f.model.stop(confirm);
    expect(f.model.stop(confirm)).toBe(closing);
    accept?.(session);
    await first;
    expect(await closing).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      findTerminalEditor.name,
      openTerminalEditor.name,
      closeTerminalEditor.name,
    ]);
  });
  it("does not silently relaunch after an uncertain connection failure", async () => {
    let opens = 0;
    const f = fixture(async (method) => {
      if (method === findTerminalEditor.name) return null;
      opens++;
      throw new Error("connection lost");
    });
    await f.model.open();
    await f.model.open();
    expect(opens).toBe(1);
    expect(f.model.getSnapshot().error).toContain("Retry");
    await f.model.open(true);
    expect(opens).toBe(2);
  });
});
