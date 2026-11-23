import { expect, it } from "vitest";
import { KnowledgeReviewModel, KnowledgeReviewPortError, type ReviewPort } from "./review-model";
import { KnowledgeReviews } from "./review-owner";
import { buildReviewDiff, applyReviewHunks } from "./review-hunks";
import { reviewTextRuns, uniqueReviewSelection, reviewSourceBlocks } from "./review-source";
const target = {
  type: "page",
  kind: "requirement",
  id: "article",
  revision: "a".repeat(64),
} as const;
const scope = { hostId: "host", target: { kind: "project", id: "project" } } as const;
const base = "First old line\n\nStable1\nStable2\nStable3\nStable4\n\nLast old line\n";
const proposal = base.replace("First old", "First new").replace("Last old", "Last new");
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(port?: Partial<ReviewPort>) {
  const writes: { body: string; reason: string }[] = [];
  const requests: Parameters<ReviewPort["propose"]>[0][] = [];
  const model = new KnowledgeReviewModel(target, base, {
    propose: async (input) => {
      requests.push(input);
      return { base, proposal };
    },
    apply: async (body, reason) => {
      writes.push({ body, reason });
    },
    ...port,
  });
  const hide = model.activate();
  return { model, hide, writes, requests };
}
function note(model: KnowledgeReviewModel) {
  return model.note({ start: 0, end: 5, selectedText: "First" }, "replace", "Changed");
}
it.each(["", "Text", "Text\n", "# Heading\n\nOld **truth**.\n", "Windows\r\nOld\r\n"])(
  "replays none/all hunks without losing any bytes: %j",
  (text) => {
    const changed = `New ${text}`;
    const diff = buildReviewDiff(text, changed);
    expect(applyReviewHunks(diff, new Set())).toBe(text);
    expect(applyReviewHunks(diff, new Set(diff.hunks.map((hunk) => hunk.id)))).toBe(changed);
  },
);
it("keeps only selected changes while preserving unrelated lines and the final newline", () => {
  const diff = buildReviewDiff(base, proposal);
  expect(diff.hunks).toHaveLength(2);
  expect(applyReviewHunks(diff, new Set([diff.hunks[0].id]))).toBe(
    base.replace("First old", "First new"),
  );
});
it("bounds the display diff matrix for large articles", () => {
  const original = "x\n".repeat(2000);
  const result = "y\n".repeat(2000);
  const diff = buildReviewDiff(original, result);
  expect(diff.hunks).toHaveLength(1);
  expect(applyReviewHunks(diff, new Set([diff.hunks[0].id]))).toBe(result);
});
it("bounds word-level diff work for long single-line articles", () => {
  const original = "old ".repeat(19000);
  const next = "new ".repeat(19000);
  const diff = buildReviewDiff(original, next);
  expect(diff.hunks).toHaveLength(1);
  expect(applyReviewHunks(diff, new Set([diff.hunks[0].id]))).toBe(next);
  expect(buildReviewDiff(original, original).hunks).toEqual([]);
});
it("keeps a proven stale-generation failure blocked until the review is discarded", async () => {
  const f = fixture({
    propose: async () => {
      throw new KnowledgeReviewPortError("conflict", "The article changed.");
    },
  });
  note(f.model);
  await f.model.generate();
  expect(f.model.getSnapshot()).toMatchObject({ blocked: true, error: "The article changed." });
  expect(await f.model.generate()).toBe(false);
});
it("maps rendered source-backed phrases, fenced content and repeated text conservatively", () => {
  const source = "# Heading\n\n**Visible** wording and `code`.\n\n```ts\nconst n = 1;\n```";
  const runs = reviewTextRuns(source);
  expect(
    runs.some((run) => run.text === "Visible" && source.slice(run.start, run.end) === "Visible"),
  ).toBe(true);
  expect(runs.some((run) => run.text === "const n = 1;")).toBe(true);
  expect(uniqueReviewSelection("Same Same", "Same")).toBeNull();
  expect(uniqueReviewSelection(source, "Visible")).toMatchObject({ selectedText: "Visible" });
  const blocks = reviewSourceBlocks(source);
  for (const block of blocks) expect(source.slice(block.start, block.end)).toBe(block.source);
  expect(blocks.at(-1)?.source).toBe("```ts\nconst n = 1;\n```");
});
it("carries the explicit provider/model with captured labels but never sends presentation labels to generation", async () => {
  const f = fixture();
  note(f.model);
  f.model.selectModel({
    provider: "openai-compatible",
    model: "local/qwen",
    providerLabel: "Local host API",
    modelLabel: "My local Qwen",
  });
  await f.model.generate();
  expect(f.requests[0].selection).toEqual({ provider: "openai-compatible", model: "local/qwen" });
  expect(f.model.getSnapshot().selection?.modelLabel).toBe("My local Qwen");
  f.model.selectModel(null);
  expect(f.model.getSnapshot().selection).toBeNull();
});
it("does not write during notes or generation and prevents overlapping/stale anchors", async () => {
  const f = fixture();
  expect(note(f.model)).toBe(true);
  expect(f.model.note({ start: 1, end: 5, selectedText: "irst" }, "refine", "Improve")).toBe(false);
  expect(f.model.note({ start: 0, end: 5, selectedText: "Wrong" }, "replace", "x")).toBe(false);
  await f.model.generate();
  expect(f.requests).toHaveLength(1);
  expect(f.writes).toEqual([]);
  expect(f.model.getSnapshot().diff?.base).toBe(base);
});
it("confirms before applying selected hunks and retains the captured target revision", async () => {
  const f = fixture();
  note(f.model);
  await f.model.generate();
  const diff = f.model.getSnapshot().diff;
  if (!diff) throw new Error("Missing diff");
  f.model.toggle(diff.hunks[1].id);
  f.model.reason("Human review");
  expect(await f.model.apply(async () => false)).toBe(false);
  expect(f.writes).toEqual([]);
  expect(await f.model.apply(async () => true)).toBe(true);
  expect(f.writes).toEqual([
    { body: base.replace("First old", "First new"), reason: "Human review" },
  ]);
  expect(f.model.target.revision).toBe(target.revision);
});
it("regenerates from the kept result while pinning every displayed diff to the original base", async () => {
  const f = fixture();
  note(f.model);
  await f.model.generate();
  f.model.reviewAcceptedResult();
  expect(f.model.getSnapshot().body).toBe(proposal);
  expect(f.model.getSnapshot().notes).toEqual([]);
  f.model.note({ start: 0, end: 5, selectedText: "First" }, "refine", "Improve more");
  await f.model.generate();
  expect(f.requests[1].workingBody).toBe(proposal);
  expect(f.model.getSnapshot().diff?.base).toBe(base);
  expect(f.writes).toEqual([]);
});
it("invalidates a hidden proposal response while retaining notes and serialized work", async () => {
  const pending = deferred<{ base: string; proposal: string }>();
  const f = fixture({ propose: () => pending.promise });
  note(f.model);
  const first = f.model.generate();
  f.hide();
  f.model.activate();
  expect(await f.model.generate()).toBe(false);
  pending.resolve({ base, proposal });
  await first;
  expect(f.model.getSnapshot().diff).toBeNull();
  expect(f.model.getSnapshot().notes).toHaveLength(1);
  expect(f.model.getSnapshot().busy).toBe(false);
});
it("retains failed generation notes without writing or automatic retry", async () => {
  let calls = 0;
  const f = fixture({
    propose: async () => {
      calls++;
      throw new Error("private provider detail");
    },
  });
  note(f.model);
  expect(await f.model.generate()).toBe(false);
  expect(calls).toBe(1);
  expect(f.model.getSnapshot().notes).toHaveLength(1);
  expect(f.model.getSnapshot().error).not.toContain("private");
  expect(f.writes).toEqual([]);
});
it("blocks a proposal for changed peer truth without adopting its revision or body", async () => {
  const f = fixture();
  note(f.model);
  f.model.peerRevision("b".repeat(64));
  expect(await f.model.generate()).toBe(false);
  expect(f.model.target.revision).toBe(target.revision);
  expect(f.model.getSnapshot().body).toBe(base);
});
it("does not accept a host proposal whose original body differs", async () => {
  const f = fixture({ propose: async () => ({ base: "Peer changed", proposal }) });
  note(f.model);
  expect(await f.model.generate()).toBe(false);
  expect(f.model.getSnapshot().blocked).toBe(true);
});
it("requires reconciliation after a hidden in-flight write and does not reapply it", async () => {
  const pending = deferred<void>();
  let writes = 0;
  const f = fixture({
    apply: () => {
      writes++;
      return pending.promise;
    },
  });
  note(f.model);
  await f.model.generate();
  f.model.reason("Review");
  const applying = f.model.apply(async () => true);
  await Promise.resolve();
  f.hide();
  f.model.activate();
  pending.resolve();
  expect(await applying).toBe(false);
  expect(f.model.getSnapshot().blocked).toBe(true);
  expect(await f.model.apply(async () => true)).toBe(false);
  expect(writes).toBe(1);
});
it("ignores a hidden confirmation without starting a host write", async () => {
  const pending = deferred<boolean>();
  const f = fixture();
  note(f.model);
  await f.model.generate();
  f.model.reason("Review");
  const applying = f.model.apply(() => pending.promise);
  f.hide();
  pending.resolve(true);
  await applying;
  expect(f.writes).toEqual([]);
});
it("keeps a failed proposal and blocks repeated uncertain writes", async () => {
  let calls = 0;
  const f = fixture({
    apply: async () => {
      calls++;
      throw new Error("uncertain");
    },
  });
  note(f.model);
  await f.model.generate();
  f.model.reason("Review");
  await f.model.apply(async () => true);
  await f.model.apply(async () => true);
  expect(calls).toBe(1);
  expect(f.model.getSnapshot().diff).not.toBeNull();
});
it("keeps separate host/project/article drafts and never adopts a reopened port", () => {
  const owner = new KnowledgeReviews();
  const port: ReviewPort = { propose: async () => ({ base, proposal }), apply: async () => {} };
  const first = owner.open(scope, target, base, port);
  note(first);
  const peer = owner.open({ ...scope, hostId: "other" }, target, "Peer", port);
  expect(peer).not.toBe(first);
  expect(owner.open(scope, { ...target, revision: "b".repeat(64) }, "New body", port)).toBe(first);
  expect(first.base).toBe(base);
  expect(first.getSnapshot().notes).toHaveLength(1);
});
