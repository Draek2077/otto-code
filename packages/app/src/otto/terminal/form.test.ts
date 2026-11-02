import { describe, expect, it } from "vitest";
import { TerminalForm, type TerminalSettingsPort } from "./form";
import type { TerminalSettings } from "@getpaseo/plugin/otto/terminal";
const initial: TerminalSettings = {
  revision: "original",
  preferences: {
    terminalTitleMode: "auto",
    terminalTitleIncludePaths: false,
    defaultTerminalShell: "system",
  },
  shells: [],
  platform: "linux",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(save: TerminalSettingsPort["save"]) {
  let reads = 0;
  const port: TerminalSettingsPort = {
    read: async () => {
      reads++;
      return initial;
    },
    save,
    diagnose: async () => ({ checkedAt: "now", checks: [] }),
  };
  const model = new TerminalForm(port);
  const close = model.activate();
  return { model, close, reads: () => reads };
}
describe("terminal settings drafts", () => {
  it("does not begin a reload from a confirmation that outlived its settings surface", async () => {
    const { model, close, reads } = setup(async () => initial);
    await Promise.resolve();
    close();
    await model.reload();
    expect(reads()).toBe(1);
  });
  it("sends only changed fields with the originating revision and prevents duplicate writes", async () => {
    const pending = deferred<TerminalSettings>();
    const calls: unknown[] = [];
    const { model, close } = setup(async (revision, patch) => {
      calls.push({ revision, patch });
      return pending.promise;
    });
    await Promise.resolve();
    model.edit({ terminalTitleMode: "default" });
    const save = model.save();
    await model.save();
    expect(calls).toEqual([{ revision: "original", patch: { terminalTitleMode: "default" } }]);
    pending.resolve({
      ...initial,
      revision: "accepted",
      preferences: { ...initial.preferences, terminalTitleMode: "default" },
    });
    await save;
    expect(model.getSnapshot()).toMatchObject({
      phase: "ready",
      saved: true,
      data: { revision: "accepted" },
    });
    close();
  });
  it("retains a failed draft and forbids retry/rebase until explicit reload", async () => {
    let calls = 0;
    const { model, close, reads } = setup(async () => {
      calls++;
      throw new Error("Peer settings changed");
    });
    await Promise.resolve();
    model.edit({ terminalTitleIncludePaths: true });
    await model.save();
    await model.save();
    expect(calls).toBe(1);
    expect(reads()).toBe(1);
    expect(model.getSnapshot()).toMatchObject({
      phase: "blocked",
      draft: { terminalTitleIncludePaths: true },
      data: { revision: "original" },
      error: "Peer settings changed",
    });
    await model.reload();
    expect(model.getSnapshot()).toMatchObject({ phase: "ready", draft: initial.preferences });
    close();
  });
  it("ignores a late accepted write after close", async () => {
    const pending = deferred<TerminalSettings>();
    const { model, close } = setup(async () => pending.promise);
    await Promise.resolve();
    model.edit({ terminalTitleMode: "default" });
    const save = model.save();
    close();
    pending.resolve({ ...initial, revision: "late" });
    await save;
    expect(model.getSnapshot().data?.revision).toBe("original");
  });
  it("reports diagnostic failure without losing the settings draft", async () => {
    const port: TerminalSettingsPort = {
      read: async () => initial,
      save: async () => initial,
      diagnose: async () => {
        throw new Error("Disconnected");
      },
    };
    const model = new TerminalForm(port);
    const close = model.activate();
    await Promise.resolve();
    model.edit({ terminalTitleIncludePaths: true });
    await model.diagnose();
    expect(model.getSnapshot()).toMatchObject({
      diagnosticPending: false,
      diagnosticError: "Disconnected",
      draft: { terminalTitleIncludePaths: true },
    });
    close();
  });
});
