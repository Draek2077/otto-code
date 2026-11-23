import { expect, it } from "vitest";
import type { KnowledgeRecord, KnowledgeScope } from "@getpaseo/plugin/otto/project-knowledge";
import { KnowledgeEditorDrafts, knowledgeEditorDraftsFor } from "./editor-drafts";

const scope: KnowledgeScope = {
  hostId: "host-a",
  target: { kind: "workspace", id: "workspace-a" },
};
const page: KnowledgeRecord = {
  id: "article",
  kind: "requirement",
  title: "Article",
  statement: "Origin truth",
  tags: [],
  revision: "a".repeat(64),
  status: "confirmed",
  updatedAt: "2026-10-25",
  timeline: "history",
  deliveryStatus: null,
  progress: null,
  referenceDisposition: null,
  sourceUrl: null,
};
const submit = async () => ({ ok: true as const });
it("retains its original scoped reload port and replaces only the explicitly reloaded draft", async () => {
  const drafts = new KnowledgeEditorDrafts();
  const targets: unknown[] = [];
  const fresh = { ...page, statement: "Fresh saved truth", revision: "b".repeat(64) };
  const model = drafts.open({
    scope,
    seed: { page },
    submit,
    readSaved: async (target) => {
      targets.push(target);
      return { page: fresh };
    },
  });
  model.set("body", "Local intent");
  const release = drafts.retain(scope, model);
  release();
  await Promise.resolve();
  const resumed = drafts.open({
    scope,
    seed: { page: fresh },
    submit,
    readSaved: async () => {
      throw new Error("A replacement port must not be adopted implicitly");
    },
  });
  expect(resumed).toBe(model);
  model.activate();
  expect(await resumed.reload(async () => true)).toBe(true);
  expect(targets).toEqual([{ type: "page", kind: "requirement", id: "article" }]);
  expect(resumed.getSnapshot().fields.body).toBe("Fresh saved truth");
  resumed.set("reason", "New explicit write");
  expect(resumed.command()).toMatchObject({ expectedRevision: fresh.revision });
  expect(drafts.get(scope)).toBe(model);
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("retains dirty intent and its origin revision after scope departure instead of rebasing from peer data", async () => {
  const drafts = new KnowledgeEditorDrafts();
  const model = drafts.open({ scope, seed: { page }, submit });
  const release = drafts.retain(scope, model);
  model.set("body", "My local edit");
  model.set("reason", "Reason");
  release();
  await Promise.resolve();
  const resumed = drafts.open({
    scope,
    seed: { page: { ...page, revision: "b".repeat(64), statement: "Peer truth" } },
    submit,
  });
  expect(resumed).toBe(model);
  expect(resumed.getSnapshot().fields.body).toBe("My local edit");
  expect(resumed.command()).toMatchObject({
    action: "truth",
    expectedRevision: page.revision,
    statement: "My local edit",
  });
  expect(await resumed.save()).toBe(false);
  expect(drafts.discard(scope, resumed)).toBe(true);
  expect(drafts.get(scope)).toBeNull();
});
it("separates installation, host, workspace and project scopes including delimiter-like identities", () => {
  const api = {};
  const otherApi = {};
  const first = knowledgeEditorDraftsFor(api);
  expect(knowledgeEditorDraftsFor(api)).toBe(first);
  expect(knowledgeEditorDraftsFor(otherApi)).not.toBe(first);
  const model = first.open({ scope, seed: { page }, submit });
  for (const foreign of [
    { ...scope, hostId: "host-b" },
    { ...scope, target: { kind: "project" as const, id: "workspace-a" } },
    { ...scope, target: { kind: "workspace" as const, id: "workspace-b" } },
  ])
    expect(first.get(foreign)).toBeNull();
  expect(first.get(scope)).toBe(model);
  expect(
    first.get({ hostId: "host-a/workspace", target: { kind: "workspace", id: "a" } }),
  ).toBeNull();
});
it("keeps a single model across effect replay and prunes only an untouched abandoned form", async () => {
  const drafts = new KnowledgeEditorDrafts();
  const model = drafts.open({ scope, seed: { page }, submit });
  const first = drafts.retain(scope, model);
  first();
  const second = drafts.retain(scope, model);
  model.activate();
  model.setActive(true);
  await Promise.resolve();
  expect(drafts.get(scope)).toBe(model);
  second();
  second();
  await Promise.resolve();
  expect(drafts.get(scope)).toBeNull();
  expect(await model.save()).toBe(false);
});
it("retains blocked and in-flight intent after unmount, ignores late success, and never replays a write on return", async () => {
  const pending = deferred<{ ok: true }>();
  let calls = 0;
  const drafts = new KnowledgeEditorDrafts();
  const model = drafts.open({
    scope,
    seed: { page },
    submit: async () => {
      calls++;
      return pending.promise;
    },
  });
  const release = drafts.retain(scope, model);
  model.set("body", "Local body");
  model.set("reason", "Reason");
  const writing = model.save();
  expect(drafts.discard(scope, model)).toBe(false);
  release();
  await Promise.resolve();
  expect(drafts.get(scope)).toBe(model);
  pending.resolve({ ok: true });
  expect(await writing).toBe(false);
  expect(model.getSnapshot()).toMatchObject({ busy: false, blocked: true, saved: false });
  const retained = drafts.retain(scope, model);
  model.activate();
  model.setActive(true);
  expect(await model.save()).toBe(false);
  expect(calls).toBe(1);
  retained();
  await Promise.resolve();
  expect(drafts.get(scope)).toBe(model);
});
it("discards only the matching idle draft and not a newer draft or another scope", () => {
  const drafts = new KnowledgeEditorDrafts();
  const model = drafts.open({ scope, seed: { page }, submit });
  expect(drafts.discard({ ...scope, hostId: "foreign" }, model)).toBe(false);
  expect(drafts.discard(scope, model)).toBe(true);
  const next = drafts.open({ scope, seed: { page }, submit });
  expect(drafts.discard(scope, model)).toBe(false);
  expect(drafts.get(scope)).toBe(next);
});
it("bounds pending local intent without silently evicting a dirty draft", () => {
  const drafts = new KnowledgeEditorDrafts();
  for (let index = 0; index < 50; index++) {
    const itemScope: KnowledgeScope = {
      ...scope,
      target: { kind: "workspace", id: `scope-${index}` },
    };
    const model = drafts.open({ scope: itemScope, seed: { page }, submit });
    model.set("reason", "Retain my intent");
  }
  expect(() => drafts.open({ scope, seed: { page }, submit })).toThrow("Finish or discard");
  const firstScope: KnowledgeScope = { ...scope, target: { kind: "workspace", id: "scope-0" } };
  const first = drafts.get(firstScope);
  if (!first) throw new Error("Lost first draft");
  expect(first.getSnapshot().fields.reason).toBe("Retain my intent");
  expect(drafts.discard(firstScope, first)).toBe(true);
  expect(drafts.open({ scope, seed: { page }, submit }).seed.page?.revision).toBe(page.revision);
});
