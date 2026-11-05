import { describe, expect, it } from "vitest";
import type { EditorSettings } from "@getpaseo/plugin/otto/editor";
import { EditorSettingsForm, type EditorSettingsPort } from "./form";

const initial: EditorSettings = {
  revision: "origin",
  preferences: {
    enabled: true,
    languages: { future: false },
    csharpProjectScope: "solution",
    maxRunningServers: 4,
    idleMinutes: 10,
    backgroundIdleMinutes: 2,
    solutionEnabled: false,
    solutionMaxProbes: 2,
    solutionIdleMinutes: 10,
    dotnetMaxProcesses: 4,
  },
};
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function open(save: EditorSettingsPort["save"]) {
  const model = new EditorSettingsForm({ read: async () => initial, save });
  const close = model.activate();
  await Promise.resolve();
  return { model, close };
}
describe("Code settings form revision ownership", () => {
  it("serializes writes and preserves newer edits across the originating revision acknowledgment", async () => {
    const pending = deferred<EditorSettings>();
    const calls: string[] = [];
    const { model, close } = await open(async (revision) => {
      calls.push(revision);
      return pending.promise;
    });
    try {
      model.edit({ idleMinutes: 15 });
      const save = model.save();
      model.edit({ idleMinutes: 30 });
      await model.save();
      pending.resolve({
        ...initial,
        revision: "accepted",
        preferences: { ...initial.preferences, idleMinutes: 15 },
      });
      await save;
      expect(calls).toEqual(["origin"]);
      expect(model.getSnapshot()).toMatchObject({
        phase: "ready",
        dirty: true,
        draft: { idleMinutes: 30, languages: { future: false } },
        saved: { revision: "accepted" },
      });
    } finally {
      close();
    }
  });
  it("retains a failed draft without rebasing or retrying until explicit reload", async () => {
    let calls = 0;
    const { model, close } = await open(async () => {
      calls++;
      throw new Error("Revision conflict");
    });
    try {
      model.edit({ enabled: false });
      await model.save();
      await model.save();
      expect(calls).toBe(1);
      expect(model.getSnapshot()).toMatchObject({
        phase: "blocked",
        dirty: true,
        draft: { enabled: false },
      });
      await model.reload();
      expect(model.getSnapshot()).toMatchObject({
        phase: "ready",
        dirty: false,
        draft: { enabled: true },
      });
    } finally {
      close();
    }
  });
  it("does not adopt a hidden write acknowledgment or silently reload over its draft", async () => {
    const pending = deferred<EditorSettings>();
    const { model, close } = await open(() => pending.promise);
    model.edit({ enabled: false });
    const save = model.save();
    close();
    const closeAgain = model.activate();
    try {
      pending.resolve({
        ...initial,
        revision: "late",
        preferences: { ...initial.preferences, enabled: false },
      });
      await save;
      expect(model.getSnapshot()).toMatchObject({
        phase: "blocked",
        saved: { revision: "origin" },
        draft: { enabled: false },
      });
    } finally {
      closeAgain();
    }
  });
});
