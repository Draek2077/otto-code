import { expect, it } from "vitest";
import type {
  KnowledgeCommand,
  KnowledgeRecord,
  KnowledgeCatalog,
} from "@getpaseo/plugin/otto/project-knowledge";
import { KnowledgeEditorModel } from "./editor-model";
import { KnowledgeLocationModel } from "./location-model";
const revision = "a".repeat(64);
function page(): KnowledgeRecord {
  return {
    id: "requirement",
    kind: "requirement",
    title: "Original",
    status: "confirmed",
    tags: ["original"],
    updatedAt: "2026-10-24",
    revision,
    statement: "Original truth",
    timeline: "history",
    deliveryStatus: null,
    referenceDisposition: null,
    sourceUrl: null,
    progress: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function settings(): KnowledgeCatalog["settings"] {
  return {
    projectId: "project-a",
    label: "A",
    revision,
    location: "repository",
    override: null,
    directoryName: null,
    path: "/repo/.otto",
  };
}

it("pins the opened revision, serializes saves and does not overwrite edits from peer snapshots", async () => {
  const seed = page();
  const pending = deferred<{ ok: true }>();
  const commands: KnowledgeCommand[] = [];
  const model = new KnowledgeEditorModel({ page: seed }, async (command) => {
    commands.push(command);
    return pending.promise;
  });
  seed.revision = "b".repeat(64);
  model.set("body", "Local draft");
  model.set("reason", "Verified change");
  const first = model.save();
  expect(await model.save()).toBe(false);
  model.set("body", "Blocked while saving");
  expect(commands).toEqual([
    {
      action: "truth",
      kind: "requirement",
      id: "requirement",
      expectedRevision: revision,
      statement: "Local draft",
      reason: "Verified change",
    },
  ]);
  pending.resolve({ ok: true });
  expect(await first).toBe(true);
  expect(await model.save()).toBe(false);
  expect(model.getSnapshot().fields.body).toBe("Local draft");
});

it("keeps dirty drafts and blocks further writes after conflict or unknown outcome", async () => {
  let calls = 0;
  const model = new KnowledgeEditorModel({ page: page() }, async () => {
    calls++;
    return { ok: false, message: "Changed on host. Reload before saving." };
  });
  model.set("body", "Unsaved draft");
  model.set("reason", "Reason");
  expect(await model.save()).toBe(false);
  expect(model.getSnapshot()).toMatchObject({ blocked: true, fields: { body: "Unsaved draft" } });
  expect(await model.save()).toBe(false);
  expect(calls).toBe(1);
});

it("invalidates hidden write acknowledgments and pending review confirmations across reactivation", async () => {
  const pending = deferred<{ ok: true }>();
  let calls = 0;
  const model = new KnowledgeEditorModel({ page: page() }, async () => {
    calls++;
    return pending.promise;
  });
  model.set("reason", "Reason");
  const authority = model.getAuthority();
  const save = model.save(authority);
  model.setActive(false);
  model.setActive(true);
  pending.resolve({ ok: true });
  expect(await save).toBe(false);
  expect(model.getSnapshot().blocked).toBe(true);
  expect(calls).toBe(1);
  const review = new KnowledgeEditorModel({ page: page(), action: "review" }, async () => {
    calls++;
    return { ok: true };
  });
  review.set("reason", "Approved");
  const confirmation = review.getAuthority();
  review.setActive(false);
  review.setActive(true);
  expect(await review.save(confirmation)).toBe(false);
  expect(calls).toBe(1);
});

it("does not resend an existing statement as new evidence and rejects invalid page IDs before writes", async () => {
  const evidence = new KnowledgeEditorModel({ page: page(), action: "evidence" }, async () => ({
    ok: true,
  }));
  expect(evidence.getSnapshot().fields.body).toBe("");
  let calls = 0;
  const create = new KnowledgeEditorModel({}, async () => {
    calls++;
    return { ok: true };
  });
  create.set("id", "../escape");
  create.set("title", "Title");
  create.set("body", "Body");
  expect(await create.save()).toBe(false);
  expect(calls).toBe(0);
  expect(create.getSnapshot().blocked).toBe(false);
});

it("closes safely and supports effect reactivation without losing the opened draft", async () => {
  const model = new KnowledgeEditorModel({ page: page() }, async () => ({ ok: true }));
  model.set("reason", "Reason");
  model.set("body", "Draft");
  model.close();
  expect(await model.save()).toBe(false);
  model.activate();
  expect(await model.save()).toBe(true);
  expect(model.getSnapshot().fields.body).toBe("Draft");
});

it("pins storage CAS, serializes migration and preserves the selected destination after failure", async () => {
  const seed = settings();
  const pending = deferred<{ ok: false; message: string }>();
  const calls: unknown[] = [];
  const model = new KnowledgeLocationModel(seed, async (location, expectedRevision) => {
    calls.push({ location, expectedRevision });
    return pending.promise;
  });
  seed.revision = "b".repeat(64);
  model.select("host");
  const save = model.save();
  expect(await model.save()).toBe(false);
  pending.resolve({ ok: false, message: "Peer settings changed" });
  expect(await save).toBe(false);
  expect(calls).toEqual([{ location: "host", expectedRevision: revision }]);
  expect(model.getSnapshot()).toMatchObject({ location: "host", blocked: true });
  expect(await model.save()).toBe(false);
});

it("does not publish late migration success or a confirmation captured while hidden", async () => {
  const pending = deferred<{ ok: true }>();
  let calls = 0;
  const model = new KnowledgeLocationModel(settings(), async () => {
    calls++;
    return pending.promise;
  });
  model.select("host");
  const authority = model.getAuthority();
  model.setActive(false);
  model.setActive(true);
  expect(await model.save(authority)).toBe(false);
  expect(calls).toBe(0);
  const save = model.save();
  model.setActive(false);
  model.setActive(true);
  pending.resolve({ ok: true });
  expect(await save).toBe(false);
  expect(model.getSnapshot().blocked).toBe(true);
});
