import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ViewKind,
  type ViewIdentity,
  type ViewReference,
} from "@getpaseo/plugin/otto/architectural-views";
import { ViewLibrary } from "./library.js";
import { ViewDrafts } from "./drafts.js";
import { ViewPublication } from "./publication.js";
import { ViewContentCache } from "./content.js";
import { readDraft, readPublished, viewDirectory, type ViewStore } from "./records.js";
import { specificationText, viewDigest } from "./specification.js";
import { viewStarter } from "./starter.js";
import { viewRevisionRecords } from "./history.js";
import type { ViewRenderInput } from "./renderer.js";

const fixtures = fileURLToPath(
  new URL("../../../../../../.tmp/archify-restoration/storage-fixtures/", import.meta.url),
);
const owners: string[] = [];
afterEach(async () => {
  for (const root of owners.splice(0)) {
    const relative = path.relative(path.resolve(fixtures), path.resolve(root));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Fixture escaped its root");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(fixtures, { recursive: true });
  const root = await mkdtemp(path.join(fixtures, "store-"));
  owners.push(root);
  const store: ViewStore = {
    projectId: "project-a",
    projectRoot: root,
    location: "repository",
    boundary: root,
    base: path.join(root, ".otto"),
    origin: { location: "repository", storeKey: viewDigest(root) },
  };
  const reference: ViewReference = { kind: "root", id: "architecture" };
  let source = viewDigest("original Knowledge");
  let renderCalls = 0;
  let beforeRender: (() => Promise<void>) | null = null;
  const library = new ViewLibrary({
    resolve: async (projectId) => {
      if (projectId !== store.projectId) throw new Error("Wrong project");
      return { selected: store, stores: [store] };
    },
    sources: async (_project, references) =>
      references.map((ref) => ({ reference: ref, sha256: source })),
  });
  const renderer = {
    render: async (input: ViewRenderInput) => {
      renderCalls++;
      await beforeRender?.();
      return {
        html: `<html>${"🙂".repeat(40000)}</html>`,
        receipt: { ok: true },
        specificationSha256: viewDigest(specificationText(input.diagramType, input.specification)),
      };
    },
  };
  const drafts = new ViewDrafts(library, renderer);
  const publication = new ViewPublication(library, renderer);
  const content = new ViewContentCache(library, renderer);
  const identity: ViewIdentity = { viewId: "system-map", origin: store.origin };
  const input = {
    scope: { hostId: "host-a", target: { kind: "project" as const, id: store.projectId } },
    viewId: identity.viewId,
    draftId: "draft-first",
    operationId: "create_first",
    title: "System map",
    diagramType: "architecture" as const,
    knowledgeReferences: [reference],
    published: null,
  };
  return {
    root,
    store,
    library,
    drafts,
    publication,
    content,
    identity,
    input,
    renderer,
    stale: () => {
      source = viewDigest("changed Knowledge");
    },
    renderCalls: () => renderCalls,
    duringRender: (callback: () => Promise<void>) => {
      beforeRender = callback;
    },
  };
}
async function authored(f: Awaited<ReturnType<typeof fixture>>) {
  const draft = await f.drafts.create(f.store.projectId, {
    ...f.input,
    specification: viewStarter("architecture", "Authored diagram"),
  });
  return {
    identity: f.identity,
    draftId: draft.draftId,
    expectedRevision: draft.revision,
    operationId: "publish_first",
  };
}
test.each(ViewKind.options)(
  "stages and publishes %s without changing source freshness or losing its exact source",
  async (diagramType) => {
    const f = await fixture();
    const specification = viewStarter(diagramType, "Source-backed view");
    const draft = await f.drafts.create(f.store.projectId, {
      ...f.input,
      diagramType,
      specification,
    });
    f.stale();
    const published = await f.publication.publish(f.store.projectId, {
      identity: f.identity,
      draftId: draft.draftId,
      expectedRevision: draft.revision,
      operationId: "publish_first",
    });
    expect(published.sourceStatus).toBe("stale");
    expect(published.diagramType).toBe(diagramType);
    expect(
      (await f.library.read(f.store.projectId, f.identity, { kind: "published" })).specification,
    ).toEqual(specification);
    expect(
      (await readDraft(f.store, f.identity.viewId, draft.draftId))?.value.ottoDraft?.state,
    ).toBe("published");
  },
);
test("create operation identities do not duplicate render/write work and cannot be reused for different intent", async () => {
  const f = await fixture();
  const first = await f.drafts.create(f.store.projectId, f.input);
  expect(await f.drafts.create(f.store.projectId, f.input)).toEqual(first);
  expect(f.renderCalls()).toBe(1);
  await expect(
    f.drafts.create(f.store.projectId, { ...f.input, title: "Different" }),
  ).rejects.toThrow("different outcome");
  await expect(
    f.publication.publish(f.store.projectId, {
      identity: f.identity,
      draftId: first.draftId,
      expectedRevision: first.revision,
      operationId: "publish_first",
    }),
  ).rejects.toThrow("staged starter");
});
test("concurrent draft editors use CAS and keep the winning bytes", async () => {
  const f = await fixture();
  const draft = await f.drafts.create(f.store.projectId, f.input);
  const results = await Promise.allSettled(
    ["Left", "Right"].map((title) =>
      f.drafts.update(f.store.projectId, {
        identity: f.identity,
        draftId: draft.draftId,
        expectedRevision: draft.revision,
        title,
        specification: viewStarter("architecture", title),
      }),
    ),
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(
    (await f.library.read(f.store.projectId, f.identity, { kind: "draft", draftId: draft.draftId }))
      .specification,
  ).toBeTruthy();
});
test("published revisions, unknown fields, removed records and original source bytes survive later publication", async () => {
  const f = await fixture();
  const first = await f.publication.publish(f.store.projectId, await authored(f));
  const file = path.join(viewDirectory(f.store, f.identity.viewId), "view.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  manifest.future = { retained: true };
  const raw = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(file, raw);
  const base = viewDigest(raw);
  const next = await f.drafts.create(f.store.projectId, {
    ...f.input,
    draftId: "draft-second",
    operationId: "create_second",
    published: { ...f.identity, revision: base },
    specification: viewStarter("architecture", "Second"),
  });
  const second = await f.publication.publish(f.store.projectId, {
    identity: f.identity,
    draftId: next.draftId,
    expectedRevision: next.revision,
    operationId: "publish_second",
  });
  expect(second.revision).not.toBe(first.revision);
  const history = await viewRevisionRecords(f.store, f.identity.viewId);
  expect(history[0]?.raw).toBe(raw);
  expect((await readPublished(f.store, f.identity.viewId))?.value.future).toEqual({
    retained: true,
  });
  expect(
    (await f.library.read(f.store.projectId, f.identity, { kind: "revision", revisionId: base }))
      .specification,
  ).toEqual(viewStarter("architecture", "Authored diagram"));
  await f.publication.remove(f.store.projectId, {
    identity: f.identity,
    expectedRevision: second.revision,
    operationId: "remove_second",
  });
  expect((await f.library.catalog(f.store.projectId)).views).toEqual([]);
  expect(
    await f.publication.remove(f.store.projectId, {
      identity: f.identity,
      expectedRevision: second.revision,
      operationId: "remove_second",
    }),
  ).toEqual({ removed: true });
  expect(
    await readdir(path.join(viewDirectory(f.store, f.identity.viewId), ".objects")),
  ).not.toHaveLength(0);
});
test("a competing publication requires explicit draft base review and preserves the draft until review", async () => {
  const f = await fixture();
  const left = await authored(f);
  const right = await f.drafts.create(f.store.projectId, {
    ...f.input,
    draftId: "draft-other",
    operationId: "create_other",
    specification: viewStarter("architecture", "Other"),
  });
  const published = await f.publication.publish(f.store.projectId, left);
  const operation = {
    identity: f.identity,
    draftId: right.draftId,
    expectedRevision: right.revision,
    operationId: "publish_other",
  };
  await expect(f.publication.publish(f.store.projectId, operation)).rejects.toThrow(
    "published View changed",
  );
  const reviewed = await f.publication.reviewBase(f.store.projectId, {
    ...operation,
    expectedPublishedRevision: published.revision,
  });
  expect(reviewed.base).toEqual({ status: "reviewed", revision: published.revision });
  expect(
    (
      await f.publication.publish(f.store.projectId, {
        ...operation,
        expectedRevision: reviewed.revision,
      })
    ).title,
  ).toBe("System map");
});
test("legacy pretty-JSON hashes and unknown metadata are read without rewriting or creating new files", async () => {
  const f = await fixture();
  const directory = viewDirectory(f.store, f.identity.viewId);
  await mkdir(directory, { recursive: true });
  const source = JSON.stringify(viewStarter("architecture", "Legacy"), null, 2);
  const manifest = JSON.stringify({
    schemaVersion: 1,
    kind: "architectural-view",
    id: f.identity.viewId,
    title: "Legacy",
    knowledgeReferences: f.input.knowledgeReferences,
    specificationSha256: viewDigest(source),
    renderedAt: "2026-01-01T00:00:00Z",
    unknown: "keep",
  });
  await writeFile(path.join(directory, "view.json"), manifest);
  await writeFile(path.join(directory, "view.architecture.json"), source + "\n");
  const read = await f.library.read(f.store.projectId, f.identity, { kind: "published" });
  expect(read.kind).toBe("published");
  if (read.kind !== "draft") expect(read.view.sourceStatus).toBe("unknown");
  expect(await readFile(path.join(directory, "view.json"), "utf8")).toBe(manifest);
  expect((await readdir(directory)).sort()).toEqual(["view.architecture.json", "view.json"]);
});
test("legacy drafts require base review, retain original files, then accept explicit edit/publish", async () => {
  const f = await fixture();
  const directory = path.join(viewDirectory(f.store, f.identity.viewId), "drafts", "legacy-draft");
  await mkdir(directory, { recursive: true });
  const source = specificationText("architecture", viewStarter("architecture", "Legacy draft"));
  await writeFile(path.join(directory, "view.architecture.json"), source);
  await writeFile(
    path.join(directory, "draft.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "architectural-view-draft",
      id: "legacy-draft",
      viewId: f.identity.viewId,
      title: "Legacy draft",
      knowledgeReferences: f.input.knowledgeReferences,
      specificationSha256: viewDigest(source),
      baseSpecificationSha256: null,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      receipt: { old: true },
      future: "retained",
    }),
  );
  const draft = (await f.library.catalog(f.store.projectId)).drafts[0]!;
  expect(draft.base.status).toBe("review_required");
  const operation = {
    identity: f.identity,
    draftId: draft.draftId,
    expectedRevision: draft.revision,
    operationId: "legacy_publish",
  };
  await expect(f.publication.publish(f.store.projectId, operation)).rejects.toThrow("legacy draft");
  const reviewed = await f.publication.reviewBase(f.store.projectId, {
    ...operation,
    expectedPublishedRevision: null,
  });
  await f.publication.publish(f.store.projectId, {
    ...operation,
    expectedRevision: reviewed.revision,
  });
  expect(await readFile(path.join(directory, "view.architecture.json"), "utf8")).toBe(source);
  expect((await readDraft(f.store, f.identity.viewId, draft.draftId))?.value.future).toBe(
    "retained",
  );
});
test("corruption is diagnosed without replacing files; foreign store identities cannot read content", async () => {
  const f = await fixture();
  const directory = viewDirectory(f.store, f.identity.viewId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "view.json"), "broken {");
  expect((await f.library.catalog(f.store.projectId)).diagnostics).toHaveLength(1);
  await expect(f.drafts.create(f.store.projectId, f.input)).rejects.toThrow();
  expect(await readFile(path.join(directory, "view.json"), "utf8")).toBe("broken {");
  await expect(
    f.library.read(
      f.store.projectId,
      { ...f.identity, origin: { ...f.identity.origin, storeKey: viewDigest("foreign") } },
      { kind: "published" },
    ),
  ).rejects.toThrow("original store");
});
test("chunked content deduplicates rendering, preserves Unicode, rejects expired revision and cross-project reuse", async () => {
  const f = await fixture();
  const published = await f.publication.publish(f.store.projectId, await authored(f));
  const input = {
    projectId: f.store.projectId,
    identity: f.identity,
    selection: { kind: "published" as const },
    expectedRevision: published.revision,
  };
  const calls = f.renderCalls();
  const [a, b] = await Promise.all([f.content.prepare(input), f.content.prepare(input)]);
  expect(a).toEqual(b);
  expect(f.renderCalls() - calls).toBe(1);
  const parts: string[] = [];
  for (let part = 0; part < a.parts; part++)
    parts.push((await f.content.part({ ...input, contentId: a.contentId, part })).text);
  expect(parts.join("")).toBe(`<html>${"🙂".repeat(40000)}</html>`);
  await expect(f.content.part({ ...input, contentId: a.contentId, part: a.parts })).rejects.toThrow(
    "Invalid",
  );
  await expect(
    f.content.part({ ...input, projectId: "foreign", contentId: a.contentId, part: 0 }),
  ).rejects.toThrow("Wrong project");
  await f.publication.remove(f.store.projectId, {
    identity: f.identity,
    expectedRevision: published.revision,
    operationId: "remove_content",
  });
  await expect(f.content.part({ ...input, contentId: a.contentId, part: 0 })).rejects.toThrow(
    "expired or changed",
  );
  f.content.close();
  await expect(f.content.prepare(input)).rejects.toThrow("shutting down");
});
test("publication operation inspection is stable and never silently republishes over a newer peer", async () => {
  const f = await fixture();
  const operation = await authored(f);
  const first = await f.publication.publish(f.store.projectId, operation);
  const calls = f.renderCalls();
  expect(await f.publication.publish(f.store.projectId, operation)).toEqual(first);
  expect(f.renderCalls()).toBe(calls);
  const next = await f.drafts.create(f.store.projectId, {
    ...f.input,
    draftId: "draft-later",
    operationId: "create_later",
    published: { ...f.identity, revision: first.revision },
    specification: viewStarter("architecture", "Later"),
  });
  await f.publication.publish(f.store.projectId, {
    identity: f.identity,
    draftId: next.draftId,
    expectedRevision: next.revision,
    operationId: "publish_later",
  });
  await expect(f.publication.publish(f.store.projectId, operation)).rejects.toThrow(
    "draft changed",
  );
});

test("publication pointer alone consumes the exact draft after an interrupted final marker", async () => {
  const f = await fixture();
  const input = await authored(f);
  const file = path.join(
    viewDirectory(f.store, f.identity.viewId),
    "drafts",
    input.draftId,
    "draft.json",
  );
  const original = await readFile(file, "utf8");
  await f.publication.publish(f.store.projectId, input);
  // Simulate the on-disk state when publication committed but the last marker did not.
  await writeFile(file, original);
  expect((await f.library.catalog(f.store.projectId)).drafts).toEqual([]);
  await expect(
    f.library.read(f.store.projectId, f.identity, { kind: "draft", draftId: input.draftId }),
  ).rejects.toThrow("no longer active");
  await expect(
    f.drafts.update(f.store.projectId, {
      ...input,
      specification: viewStarter("architecture", "Replay"),
    }),
  ).rejects.toThrow("already published");
  expect((await f.publication.publish(f.store.projectId, input)).state).toBe("published");
});
test("origin-bound catalog search and author binding retain canonical project and workspace identities", async () => {
  const f = await fixture();
  const input = await authored(f);
  const draft = await f.drafts.bindAuthor(
    f.store.projectId,
    f.identity,
    input.draftId,
    input.expectedRevision,
    "author",
    "workspace-a",
  );
  expect(draft.authoringWorkspaceId).toBe("workspace-a");
  const result = await f.library.catalog(f.store.projectId, undefined, 0, "map");
  expect(result.projectId).toBe(f.store.projectId);
  expect(result.origins).toEqual([f.store.origin]);
  expect(result.drafts).toHaveLength(1);
  expect((await f.library.catalog(f.store.projectId, undefined, 0, "no match")).drafts).toEqual([]);
  const detached = await f.drafts.bindAuthor(
    f.store.projectId,
    f.identity,
    draft.draftId,
    draft.revision,
    null,
  );
  expect(detached.authoringAgentId).toBeNull();
  expect(detached.authoringWorkspaceId).toBeNull();
});
