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
it("reloads only after confirmation and uses the newly read revision for a separate explicit save", async () => {
  const commands: KnowledgeCommand[] = [];
  let reads = 0;
  const fresh = {
    ...page(),
    revision: "b".repeat(64),
    statement: "Peer truth",
    title: "Peer title",
  };
  const model = new KnowledgeEditorModel(
    { page: page() },
    async (command) => {
      commands.push(command);
      return commands.length === 1
        ? { ok: false, code: "conflict", message: "Changed" }
        : { ok: true };
    },
    async () => {
      reads++;
      return { page: fresh };
    },
  );
  model.set("body", "My local draft");
  model.set("reason", "My reason");
  expect(await model.save()).toBe(false);
  expect(await model.reload(async () => false)).toBe(false);
  expect(reads).toBe(0);
  expect(model.getSnapshot()).toMatchObject({
    fields: { body: "My local draft", reason: "My reason" },
    blocked: true,
    lockBlocked: false,
  });
  expect(await model.reload(async () => true)).toBe(true);
  expect(reads).toBe(1);
  expect(commands).toHaveLength(1);
  expect(model.getSnapshot()).toMatchObject({
    fields: { body: "Peer truth", reason: "", title: "Peer title" },
    blocked: false,
    reloadVersion: 1,
  });
  expect(model.hasChanges()).toBe(false);
  model.set("body", "Explicitly reviewed peer truth");
  model.set("reason", "Reviewed after reload");
  expect(await model.save()).toBe(true);
  expect(commands[1]).toMatchObject({
    expectedRevision: fresh.revision,
    statement: "Explicitly reviewed peer truth",
  });
});
it("retains the original draft, revision and lock cause if a confirmed reload read fails", async () => {
  const model = new KnowledgeEditorModel(
    { page: page() },
    async () => ({ ok: false, code: "busy", message: "Store locked" }),
    async () => {
      throw new Error("private path");
    },
  );
  model.set("body", "Retained");
  model.set("reason", "Reason");
  await model.save();
  expect(model.getSnapshot().lockBlocked).toBe(true);
  expect(await model.reload(async () => true)).toBe(false);
  expect(model.getSnapshot()).toMatchObject({
    blocked: true,
    lockBlocked: true,
    fields: { body: "Retained", reason: "Reason" },
    error:
      "Saved Knowledge could not be read. Your local draft and its original revision are retained.",
  });
  expect(model.command()).toMatchObject({ expectedRevision: revision });
});
it("keeps a blocked operation's explanation visible while its local fields are edited", async () => {
  const model = new KnowledgeEditorModel({ page: page() }, async () => ({
    ok: false,
    code: "conflict",
    message: "Reload before saving",
  }));
  model.set("reason", "Reason");
  await model.save();
  model.set("body", "New local edit");
  expect(model.getSnapshot()).toMatchObject({
    blocked: true,
    lockBlocked: false,
    error: "Reload before saving",
  });
});
it("serializes reload confirmation, read and save without allowing a second operation", async () => {
  const confirmation = deferred<boolean>();
  let reads = 0;
  let writes = 0;
  const model = new KnowledgeEditorModel(
    { page: page() },
    async () => {
      writes++;
      return { ok: true };
    },
    async () => {
      reads++;
      return { page: page() };
    },
  );
  model.set("reason", "Reason");
  const reload = model.reload(() => confirmation.promise);
  expect(await model.reload(async () => true)).toBe(false);
  expect(await model.save()).toBe(false);
  confirmation.resolve(true);
  expect(await reload).toBe(true);
  expect(reads).toBe(1);
  expect(writes).toBe(0);
});
it("invalidates a reload confirmation captured before hide/reactivation", async () => {
  const confirmation = deferred<boolean>();
  let reads = 0;
  const model = new KnowledgeEditorModel(
    { page: page() },
    async () => ({ ok: true }),
    async () => {
      reads++;
      return { page: page() };
    },
  );
  model.set("body", "Keep");
  const reload = model.reload(() => confirmation.promise);
  model.setActive(false);
  model.setActive(true);
  confirmation.resolve(true);
  expect(await reload).toBe(false);
  expect(reads).toBe(0);
  expect(model.getSnapshot().fields.body).toBe("Keep");
});
it("ignores a late successful reload after hide and retains the old revision", async () => {
  const response = deferred<{ page: KnowledgeRecord }>();
  const model = new KnowledgeEditorModel(
    { page: page() },
    async () => ({ ok: true }),
    () => response.promise,
  );
  model.set("body", "Keep");
  model.set("reason", "Retained reason");
  const reload = model.reload(async () => true);
  await Promise.resolve();
  model.setActive(false);
  model.setActive(true);
  response.resolve({ page: { ...page(), revision: "b".repeat(64), statement: "Late" } });
  expect(await reload).toBe(false);
  expect(model.getSnapshot()).toMatchObject({ busy: false, fields: { body: "Keep" } });
  expect(model.command()).toMatchObject({ expectedRevision: revision });
});
it("refuses a reload that returns a different page instead of silently changing edit targets", async () => {
  const model = new KnowledgeEditorModel(
    { page: page() },
    async () => ({ ok: true }),
    async () => ({ page: { ...page(), id: "other" } }),
  );
  model.set("body", "Keep");
  expect(await model.reload(async () => true)).toBe(false);
  expect(model.getSnapshot().fields.body).toBe("Keep");
});
it("reloads a root body against its own fresh digest without inventing record review metadata", async () => {
  const model = new KnowledgeEditorModel(
    { root: { slug: "architecture", body: "Old root", revision } },
    async () => ({ ok: true }),
    async () => ({ root: { slug: "architecture", body: "New root", revision: "b".repeat(64) } }),
  );
  model.set("body", "Local root");
  expect(await model.reload(async () => true)).toBe(true);
  expect(model.command()).toEqual({
    action: "root",
    slug: "architecture",
    expectedRevision: "b".repeat(64),
    body: "New root",
  });
});
it("reconciles an uncertain creation by reading the submitted identity and never repeating create", async () => {
  const targets: unknown[] = [];
  const commands: KnowledgeCommand[] = [];
  const saved = { ...page(), id: "created", revision: "b".repeat(64), statement: "Saved creation" };
  const model = new KnowledgeEditorModel(
    {},
    async (command) => {
      commands.push(command);
      if (commands.length === 1) throw new Error("Lost acknowledgment");
      return { ok: true };
    },
    async (target) => {
      targets.push(target);
      return { page: saved };
    },
  );
  expect(model.supportsReload()).toBe(false);
  model.set("id", "created");
  model.set("title", "Created");
  model.set("body", "Creation draft");
  expect(await model.save()).toBe(false);
  expect(model.supportsReload()).toBe(true);
  model.set("id", "not-attempted");
  expect(await model.reload(async () => true)).toBe(true);
  expect(targets).toEqual([{ type: "page", kind: "requirement", id: "created" }]);
  expect(model.getSnapshot()).toMatchObject({
    fields: { action: "truth", id: "created", body: "Saved creation" },
    blocked: false,
  });
  model.set("reason", "Reviewed existing saved page");
  expect(await model.save()).toBe(true);
  expect(commands.map((command) => command.action)).toEqual(["create", "truth"]);
  expect(commands[1]).toMatchObject({ expectedRevision: saved.revision });
});
it("keeps an uncertain creation blocked with its full local draft if the submitted page cannot be read", async () => {
  const model = new KnowledgeEditorModel(
    {},
    async () => {
      throw new Error("Lost acknowledgment");
    },
    async () => {
      throw new Error("Not found");
    },
  );
  model.set("id", "created");
  model.set("title", "Created");
  model.set("body", "Creation draft");
  await model.save();
  expect(await model.reload(async () => true)).toBe(false);
  expect(model.getSnapshot()).toMatchObject({
    fields: { action: "create", id: "created", title: "Created", body: "Creation draft" },
    blocked: true,
  });
  expect(await model.save()).toBe(false);
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

it("pins purge revision/reason, retains failed drafts and rejects stale destructive confirmations", async () => {
  const calls: KnowledgeCommand[] = [];
  const model = new KnowledgeEditorModel({ page: page(), action: "purge" }, async (command) => {
    calls.push(command);
    return { ok: false, message: "Purge requires reconciliation" };
  });
  model.set("reason", "Explicitly approved deletion");
  const authority = model.getAuthority();
  model.setActive(false);
  model.setActive(true);
  expect(await model.save(authority)).toBe(false);
  expect(calls).toEqual([]);
  expect(await model.save()).toBe(false);
  expect(calls).toEqual([
    {
      action: "purge",
      kind: "requirement",
      id: "requirement",
      expectedRevision: revision,
      reason: "Explicitly approved deletion",
    },
  ]);
  expect(model.getSnapshot()).toMatchObject({
    blocked: true,
    fields: { reason: "Explicitly approved deletion" },
  });
  expect(await model.save()).toBe(false);
  expect(calls).toHaveLength(1);
});
