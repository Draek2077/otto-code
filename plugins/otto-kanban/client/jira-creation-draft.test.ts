import { expect, it } from "vitest";
import { JiraCreationDraft } from "./jira-creation-draft.js";
import type { JiraCreateOptions, Result } from "../shared/model.js";
const choices: JiraCreateOptions = {
  projects: [{ id: "project", label: "Explicit project" }],
  issueTypes: [{ id: "type", label: "Task" }],
  revision: "metadata-origin",
  available: true,
  message: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}
it("does not choose the first project or type and pins only an explicit ready selection", async () => {
  const requests: unknown[] = [];
  const edits: boolean[] = [];
  const draft = new JiraCreationDraft(
    async (selection) => {
      requests.push(selection);
      return { ok: true, value: choices };
    },
    (edited) => edits.push(edited),
  );
  expect(requests).toEqual([]);
  const hide = draft.activate();
  await settle();
  expect(draft.mutation()).toBeNull();
  draft.selectProject("project");
  await settle();
  expect(draft.mutation()).toBeNull();
  draft.selectType("type");
  await settle();
  expect(draft.mutation()).toEqual({
    projectId: "project",
    issueTypeId: "type",
    expectedCreateRevision: "metadata-origin",
  });
  expect(requests).toEqual([
    {},
    { projectId: "project" },
    { projectId: "project", issueTypeId: "type" },
  ]);
  expect(edits.filter(Boolean)).toHaveLength(2);
  hide();
});
it("prevents a stale earlier lookup from overwriting a newer explicit choice", async () => {
  const old = deferred<Result<JiraCreateOptions>>();
  let reads = 0;
  const draft = new JiraCreationDraft(
    async () => (++reads === 2 ? old.promise : { ok: true, value: choices }),
    () => {},
  );
  const hide = draft.activate();
  await settle();
  draft.selectProject("project");
  draft.selectProject("project");
  await settle();
  old.resolve({ ok: true, value: { ...choices, projects: [], revision: "old" } });
  await settle();
  expect(draft.getSnapshot().options?.projects).toEqual(choices.projects);
  hide();
});
it("ignores a hidden lookup and performs a fresh read when the unfinished form is shown again", async () => {
  const old = deferred<Result<JiraCreateOptions>>();
  let reads = 0;
  const draft = new JiraCreationDraft(
    async () => (++reads === 1 ? old.promise : { ok: true, value: choices }),
    () => {},
  );
  draft.activate()();
  old.resolve({ ok: true, value: { ...choices, revision: "old" } });
  await settle();
  expect(draft.getSnapshot().options).toBeNull();
  const hide = draft.activate();
  await settle();
  expect(reads).toBe(2);
  expect(draft.getSnapshot().options?.revision).toBe("metadata-origin");
  hide();
});
it("keeps explicit selections and exposes failed lookup recovery without allowing a create", async () => {
  let failed = false;
  const draft = new JiraCreationDraft(
    async () =>
      failed
        ? { ok: false, error: { code: "access_denied", message: "Jira denied creation metadata" } }
        : { ok: true, value: choices },
    () => {},
  );
  const hide = draft.activate();
  await settle();
  draft.selectProject("project");
  await settle();
  failed = true;
  draft.selectType("type");
  await settle();
  expect(draft.getSnapshot()).toMatchObject({
    projectId: "project",
    issueTypeId: "type",
    error: "Jira denied creation metadata",
    projectLabel: "Explicit project",
    issueTypeLabel: "Task",
  });
  expect(draft.mutation()).toBeNull();
  failed = false;
  await draft.reload();
  expect(draft.mutation()).toMatchObject({ expectedCreateRevision: "metadata-origin" });
  hide();
});
it("treats transport failures as local read errors and keeps create unavailable", async () => {
  const draft = new JiraCreationDraft(
    async () => {
      throw new Error("private transport text");
    },
    () => {},
  );
  const hide = draft.activate();
  await settle();
  expect(draft.getSnapshot().error).toBe(
    "Jira creation choices could not be read. Your local draft is retained.",
  );
  expect(draft.mutation()).toBeNull();
  hide();
});
it("does not reuse an earlier type's revision when a newer lookup is hidden before it settles", async () => {
  const pending = deferred<Result<JiraCreateOptions>>();
  let pendingType = false;
  let reads = 0;
  const draft = new JiraCreationDraft(
    async () => {
      reads++;
      return pendingType ? pending.promise : { ok: true, value: choices };
    },
    () => {},
  );
  const hide = draft.activate();
  await settle();
  draft.selectProject("project");
  await settle();
  pendingType = true;
  draft.selectType("type");
  hide();
  expect(draft.mutation()).toBeNull();
  pending.resolve({ ok: true, value: { ...choices, revision: "hidden" } });
  await settle();
  expect(draft.getSnapshot().options).toBeNull();
  pendingType = false;
  const release = draft.activate();
  await settle();
  expect(reads).toBe(4);
  expect(draft.mutation()).toMatchObject({ expectedCreateRevision: "metadata-origin" });
  release();
});
