import { describe, expect, it, vi } from "vitest";
import { openTargetForm } from "./target-form.js";
import type { ProjectConfiguration, Result } from "../shared/model.js";

const binding = { hostId: "host-a", projectId: "project-a" };
const snapshot: ProjectConfiguration = {
  binding,
  settingsRevision: "r1",
  target: { adapter: "github", boardId: "7", boardOwner: "shared" },
};

describe("project board settings form", () => {
  it("saves only identifiers with the opened host/project/revision", async () => {
    const saved: ProjectConfiguration = {
      ...snapshot,
      settingsRevision: "r2",
      target: { adapter: "github", boardId: "8", boardOwner: "shared" },
    };
    const save = vi.fn(async () => ({ ok: true as const, value: saved }));
    const form = openTargetForm({ snapshot, save });
    form.setBoardId("8");
    expect(await form.save()).toEqual(saved);
    expect(save).toHaveBeenCalledWith({
      binding,
      expectedRevision: "r1",
      target: { adapter: "github", boardId: "8", boardOwner: "shared" },
    });
    expect(form.getSnapshot()).toMatchObject({ dirty: false, busy: false, error: "" });
  });
  it("retains the draft and conflict so a failed save cannot discard unsent edits", async () => {
    const form = openTargetForm({
      snapshot,
      save: async () => ({
        ok: false,
        error: { code: "revision_conflict", message: "Reload Project Settings before saving." },
      }),
    });
    form.setBoardId("8");
    expect(await form.save()).toBeNull();
    expect(form.getSnapshot()).toMatchObject({
      boardId: "8",
      dirty: true,
      busy: false,
      errorCode: "revision_conflict",
      error: "Reload Project Settings before saving.",
    });
  });
  it("prevents duplicate saves and input changes while the current save is pending", async () => {
    let finish: ((result: Result<ProjectConfiguration>) => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<Result<ProjectConfiguration>>((resolve) => {
          finish = resolve;
        }),
    );
    const form = openTargetForm({ snapshot, save });
    form.setBoardId("8");
    const pending = form.save();
    expect(form.getSnapshot().busy).toBe(true);
    expect(await form.save()).toBeNull();
    form.setBoardId("9");
    expect(form.getSnapshot().boardId).toBe("8");
    if (!finish) throw new Error("The save did not start");
    finish({ ok: true, value: { ...snapshot, settingsRevision: "r2" } });
    await pending;
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("does not retain the previous board owner when a new owner is supplied by a URL", () => {
    const form = openTargetForm({
      snapshot,
      save: async () => {
        throw new Error("not saving");
      },
    });
    form.setBoardId("https://github.com/orgs/other/projects/2");
    expect(form.getSnapshot().boardOwner).toBe("");
  });
  it("explicit clearing submits null, without rewriting the opened snapshot", async () => {
    const original = structuredClone(snapshot);
    const save = vi.fn(async () => ({
      ok: true as const,
      value: { ...snapshot, settingsRevision: "r2", target: null },
    }));
    const form = openTargetForm({ snapshot, save });
    form.setEnabled(false);
    await form.save();
    expect(save).toHaveBeenCalledWith({ binding, expectedRevision: "r1", target: null });
    expect(snapshot).toEqual(original);
  });
  it("hides unexpected transport details while preserving the draft", async () => {
    const form = openTargetForm({
      snapshot,
      save: async () => {
        throw new Error("secret");
      },
    });
    form.setBoardId("8");
    expect(await form.save()).toBeNull();
    expect(form.getSnapshot()).toMatchObject({
      boardId: "8",
      busy: false,
      dirty: true,
      error: "Project Settings could not be saved. Your changes are still here.",
    });
  });

  it("uses only its own acknowledged revision for the next explicit save", async () => {
    const save = vi.fn(async (_input: { expectedRevision: string }) => ({
      ok: true as const,
      value: { ...snapshot, settingsRevision: "r2" },
    }));
    const form = openTargetForm({ snapshot, save });
    form.setBoardId("8");
    await form.save();
    form.setBoardId("9");
    await form.save();
    expect(save.mock.calls.map(([input]) => input.expectedRevision)).toEqual(["r1", "r2"]);
  });

  it("does not erase conflicts or retry after editing the retained draft", async () => {
    const save = vi.fn(async () => ({
      ok: false as const,
      error: { code: "revision_conflict" as const, message: "Reload before saving." },
    }));
    const form = openTargetForm({ snapshot, save });
    form.setBoardId("8");
    await form.save();
    form.setBoardId("9");
    expect(await form.save()).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    expect(form.getSnapshot()).toMatchObject({
      boardId: "9",
      dirty: true,
      reloadRequired: true,
      error: "Reload before saving.",
    });
  });

  it("keeps edits when an explicit reload fails and adopts a revision only after a valid read", async () => {
    const form = openTargetForm({ snapshot, save: async () => ({ ok: true, value: snapshot }) });
    form.setBoardId("unsaved");
    expect(
      await form.reload(async () => {
        throw new Error("private transport detail");
      }),
    ).toBe(false);
    expect(form.getSnapshot()).toMatchObject({ boardId: "unsaved", dirty: true, busy: false });
    expect(form.getRevision()).toBe("r1");
    expect(
      await form.reload(async () => ({
        ok: true,
        value: { ...snapshot, settingsRevision: "r3", target: null },
      })),
    ).toBe(true);
    expect(form.getSnapshot()).toMatchObject({ boardId: "", dirty: false, generation: 1 });
    expect(form.getRevision()).toBe("r3");
  });
});
