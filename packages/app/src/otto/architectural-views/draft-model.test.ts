import { expect, test, vi } from "vitest";
import type { ViewDraft, ViewSummary } from "@getpaseo/plugin/otto/architectural-views";
import { ViewDraftModel, type DraftDocument, type DraftPorts } from "./draft-model";
import { ViewRequestError } from "./errors";
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const draft: ViewDraft = {
  viewId: "system",
  draftId: "draft-first",
  title: "Original",
  diagramType: "architecture",
  origin: { location: "repository", storeKey: "a".repeat(64) },
  revision: "b".repeat(64),
  knowledgeReferences: [{ kind: "root", id: "architecture" }],
  sourceStatus: "current",
  base: { status: "reviewed", revision: null },
  authoringAgentId: null,
  authoringWorkspaceId: null,
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
  starter: false,
};
function document(metadata = draft): DraftDocument {
  return {
    kind: "draft",
    draft: metadata,
    specification: { diagram_type: "architecture", title: "Original" },
  };
}
const summary: ViewSummary = {
  viewId: draft.viewId,
  title: draft.title,
  diagramType: draft.diagramType,
  origin: draft.origin,
  revision: "c".repeat(64),
  knowledgeReferences: draft.knowledgeReferences,
  sourceStatus: "current",
  renderedAt: "2026-11-01",
  state: "published",
};
function fixture() {
  const ports: DraftPorts = {
    read: vi.fn(async () => document({ ...draft, revision: "d".repeat(64) })),
    save: vi.fn(async () => ({ ...draft, revision: "e".repeat(64) })),
    publish: vi.fn(async () => summary),
    discard: vi.fn(async () => ({ discarded: true })),
    changed: vi.fn(),
  };
  const model = new ViewDraftModel(document(), ports);
  return { model, ports };
}
test("inactive drafts have no write authority and active saves pin their originating revision", async () => {
  const f = fixture();
  f.model.editText('{"title":"Edited"}');
  expect(await f.model.save()).toBe(false);
  expect(f.ports.save).not.toHaveBeenCalled();
  const release = f.model.retain();
  expect(await f.model.save()).toBe(true);
  expect(f.ports.save).toHaveBeenCalledWith({
    expectedRevision: draft.revision,
    title: "Original",
    specification: { title: "Edited" },
  });
  expect(f.model.getSnapshot().draft.revision).toBe("e".repeat(64));
  expect(f.model.getSnapshot().dirty).toBe(false);
  release();
});
test("one writer serializes Save/Publish/Discard, preserving newer source and title edits during acknowledgment", async () => {
  const f = fixture(),
    response = deferred<ViewDraft>();
  f.ports.save = vi.fn(() => response.promise);
  f.model.setPorts(f.ports);
  const release = f.model.retain();
  f.model.editText('{"title":"Submitted"}');
  const saving = f.model.save();
  expect(await f.model.save()).toBe(false);
  expect(await f.model.publishView(async () => true)).toBeNull();
  expect(await f.model.discard(async () => true)).toBe(false);
  f.model.editText('{"title":"Newer"}');
  f.model.editTitle("New title");
  response.resolve({ ...draft, title: "Normalized", revision: "f".repeat(64) });
  expect(await saving).toBe(true);
  expect(f.model.getSnapshot()).toMatchObject({
    text: '{"title":"Newer"}',
    title: "New title",
    dirty: true,
  });
  expect(f.model.getSnapshot().draft.revision).toBe("f".repeat(64));
  release();
});
test.each(["conflict", "unknown", "unavailable"] as const)(
  "%s preserves dirty text, blocks replay and does not rebase from peer snapshots",
  async (code) => {
    const f = fixture();
    f.ports.save = vi.fn(async () => {
      throw new ViewRequestError(code, "Inspect");
    });
    f.model.setPorts(f.ports);
    const release = f.model.retain();
    f.model.editText('{"new":true}');
    expect(await f.model.save()).toBe(false);
    f.model.observe(document({ ...draft, revision: "f".repeat(64) }));
    expect(f.model.getSnapshot()).toMatchObject({
      blocked: true,
      peerChanged: true,
      text: '{"new":true}',
    });
    expect(f.model.getSnapshot().draft.revision).toBe(draft.revision);
    expect(await f.model.save()).toBe(false);
    expect(f.ports.save).toHaveBeenCalledOnce();
    release();
  },
);
test("known validation rejection permits a corrected explicit Save against the same revision", async () => {
  const f = fixture();
  const save = vi
    .fn<DraftPorts["save"]>()
    .mockRejectedValueOnce(new ViewRequestError("invalid", "Fix geometry"))
    .mockResolvedValue({ ...draft, revision: "f".repeat(64) });
  f.ports.save = save;
  f.model.setPorts(f.ports);
  const release = f.model.retain();
  f.model.editText('{"node":"bad"}');
  expect(await f.model.save()).toBe(false);
  expect(f.model.getSnapshot().blocked).toBe(false);
  f.model.editText('{"node":"good"}');
  expect(await f.model.save()).toBe(true);
  expect(save.mock.calls.map(([input]) => input.expectedRevision)).toEqual([
    draft.revision,
    draft.revision,
  ]);
  release();
});
test("local JSON/budget rejection performs no host write and retains the editable draft", async () => {
  const f = fixture(),
    release = f.model.retain();
  for (const text of ["{broken", "[]", JSON.stringify({ value: "x".repeat(524288) })]) {
    f.model.editText(text);
    expect(await f.model.save()).toBe(false);
    expect(f.model.getSnapshot().text).toBe(text);
    expect(f.model.getSnapshot().blocked).toBe(false);
  }
  expect(f.ports.save).not.toHaveBeenCalled();
  release();
});
test.each(["success", "failure"] as const)(
  "hidden pending Save %s cannot adopt a late revision across reactivation",
  async (outcome) => {
    const f = fixture(),
      response = deferred<ViewDraft>();
    f.ports.save = vi.fn(() => response.promise);
    f.model.setPorts(f.ports);
    const release = f.model.retain();
    f.model.editText('{"edited":true}');
    const saving = f.model.save();
    release();
    const releaseAgain = f.model.retain();
    if (outcome === "success") response.resolve({ ...draft, revision: "f".repeat(64) });
    else response.reject(new Error("Disconnected"));
    expect(await saving).toBe(false);
    expect(f.model.getSnapshot()).toMatchObject({ blocked: true, dirty: true, busy: false });
    expect(f.model.getSnapshot().draft.revision).toBe(draft.revision);
    expect(await f.model.reload(async () => false)).toBe(false);
    expect(f.ports.read).not.toHaveBeenCalled();
    expect(await f.model.reload(async () => true)).toBe(true);
    expect(f.model.getSnapshot()).toMatchObject({ blocked: false, dirty: false });
    releaseAgain();
  },
);
test("reload never overwrites newer edits made during its confirmation or read", async () => {
  const f = fixture(),
    release = f.model.retain(),
    confirmation = deferred<boolean>();
  const first = f.model.reload(() => confirmation.promise);
  f.model.editTitle("New while asking");
  confirmation.resolve(true);
  expect(await first).toBe(false);
  expect(f.ports.read).not.toHaveBeenCalled();
  const read = deferred<DraftDocument>();
  f.ports.read = vi.fn(() => read.promise);
  f.model.setPorts(f.ports);
  const second = f.model.reload(async () => true);
  await Promise.resolve();
  f.model.editText('{"new":"during read"}');
  read.resolve(document());
  expect(await second).toBe(false);
  expect(f.model.getSnapshot().text).toBe('{"new":"during read"}');
  expect(f.model.getSnapshot().title).toBe("New while asking");
  release();
});
test("human publication pins the saved draft and never launches on stale or hidden confirmation", async () => {
  const f = fixture(),
    confirmation = deferred<boolean>(),
    release = f.model.retain();
  const first = f.model.publishView(() => confirmation.promise);
  release();
  const again = f.model.retain();
  confirmation.resolve(true);
  expect(await first).toBeNull();
  expect(f.ports.publish).not.toHaveBeenCalled();
  expect(await f.model.reload(async () => true)).toBe(true);
  expect(await f.model.publishView(async () => true)).toEqual(summary);
  expect(f.ports.publish).toHaveBeenCalledWith("d".repeat(64), expect.any(String));
  again();
});
test("new local intent during a confirmation or accepted publication is never silently discarded", async () => {
  const f = fixture(),
    confirmation = deferred<boolean>(),
    release = f.model.retain();
  const first = f.model.publishView(() => confirmation.promise);
  f.model.editText('{"new":true}');
  confirmation.resolve(true);
  expect(await first).toBeNull();
  expect(f.ports.publish).not.toHaveBeenCalled();
  await f.model.reload(async () => true);
  const reply = deferred<ViewSummary>();
  f.ports.publish = vi.fn(() => reply.promise);
  f.model.setPorts(f.ports);
  const second = f.model.publishView(async () => true);
  await Promise.resolve();
  f.model.editText('{"new":"after admission"}');
  reply.resolve(summary);
  expect(await second).toBeNull();
  expect(f.model.getSnapshot()).toMatchObject({
    dirty: true,
    blocked: true,
    text: '{"new":"after admission"}',
  });
  release();
});
test("unreviewed starter and unsaved edits cannot be published", async () => {
  const f = fixture(),
    release = f.model.retain();
  f.model.editTitle("Dirty");
  expect(await f.model.publishView(async () => true)).toBeNull();
  expect(f.ports.publish).not.toHaveBeenCalled();
  release();
  const model = new ViewDraftModel(document({ ...draft, starter: true }), f.ports),
    end = model.retain();
  expect(await model.publishView(async () => true)).toBeNull();
  expect(f.ports.publish).not.toHaveBeenCalled();
  end();
});

test("a legacy draft base must be explicitly reviewed before human publication can be sent", async () => {
  const f = fixture();
  const model = new ViewDraftModel(
    document({ ...draft, base: { status: "review_required", legacySpecificationSha256: null } }),
    f.ports,
  );
  const release = model.retain();
  expect(await model.publishView(async () => true)).toBeNull();
  expect(f.ports.publish).not.toHaveBeenCalled();
  release();
});
