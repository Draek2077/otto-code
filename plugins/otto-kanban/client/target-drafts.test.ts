import { expect, test, vi } from "vitest";
import { ProjectTargetDrafts } from "./target-drafts.js";
import type { ProjectConfiguration, Result } from "../shared/model.js";

const snapshot: ProjectConfiguration = {
  binding: { hostId: "a", projectId: "project" },
  settingsRevision: "r1",
  target: null,
};
const save = async (): Promise<Result<ProjectConfiguration>> => ({ ok: true, value: snapshot });

test("dirty drafts survive leaving and reopening, retaining the originating revision", () => {
  const drafts = new ProjectTargetDrafts();
  const model = drafts.open(snapshot, save);
  const release = drafts.retain(model);
  model.setEnabled(true);
  model.setBoardId("42");
  release();
  const reopened = drafts.open({ ...snapshot, settingsRevision: "peer-r2" }, save);
  expect(reopened).toBe(model);
  expect(reopened.getRevision()).toBe("r1");
  expect(reopened.getSnapshot()).toMatchObject({ boardId: "42", dirty: true });
  drafts.dispose();
});

test("the same project ID on another host never receives the first host's draft", () => {
  const drafts = new ProjectTargetDrafts();
  const first = drafts.open(snapshot, save);
  first.setBoardId("secret-free-local-edit");
  const other = drafts.open({ ...snapshot, binding: { hostId: "b", projectId: "project" } }, save);
  expect(other).not.toBe(first);
  expect(other.getSnapshot().boardId).toBe("");
  expect(other.binding).toEqual({ hostId: "b", projectId: "project" });
  drafts.dispose();
});

test("clean forms are released and can reload a newer host revision", () => {
  const drafts = new ProjectTargetDrafts();
  const first = drafts.open(snapshot, save);
  drafts.retain(first)();
  const reopened = drafts.open({ ...snapshot, settingsRevision: "r2" }, save);
  expect(reopened).not.toBe(first);
  expect(reopened.getRevision()).toBe("r2");
  drafts.dispose();
});

test("a pending save survives closing, cannot be discarded, and releases after acknowledgment", async () => {
  let finish!: (value: Result<ProjectConfiguration>) => void;
  const write = vi.fn(
    () =>
      new Promise<Result<ProjectConfiguration>>((resolve) => {
        finish = resolve;
      }),
  );
  const drafts = new ProjectTargetDrafts();
  const first = drafts.open(snapshot, write);
  const release = drafts.retain(first);
  first.setBoardId("42");
  const pending = first.save();
  release();
  expect(drafts.discard(first)).toBe(false);
  expect(drafts.open({ ...snapshot, settingsRevision: "r2" }, write)).toBe(first);
  finish({ ok: true, value: { ...snapshot, settingsRevision: "r2" } });
  await pending;
  const reopened = drafts.open({ ...snapshot, settingsRevision: "r2" }, write);
  expect(reopened).not.toBe(first);
  expect(write).toHaveBeenCalledTimes(1);
  drafts.dispose();
});

test("explicit discard replaces only the selected project's draft", () => {
  const drafts = new ProjectTargetDrafts();
  const first = drafts.open(snapshot, save);
  const otherSnapshot = { ...snapshot, binding: { hostId: "a", projectId: "other" } };
  const other = drafts.open(otherSnapshot, save);
  first.setBoardId("1");
  other.setBoardId("2");
  expect(drafts.discard(first)).toBe(true);
  expect(drafts.open(snapshot, save).getSnapshot().boardId).toBe("");
  expect(drafts.open(otherSnapshot, save)).toBe(other);
  expect(other.getSnapshot().boardId).toBe("2");
  drafts.dispose();
});
