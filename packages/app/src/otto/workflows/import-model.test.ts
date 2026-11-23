import { test, expect, vi } from "vitest";
import { WorkflowImportForm } from "./import-model";
import type { WorkflowApi } from "./api";
import { scope, authored, entry, deferred } from "./test-fixtures";
const source = {
  storeKey: "source",
  location: "repository" as const,
  source: "project-store" as const,
};
function fixture() {
  const exported = {
      format: "otto.workflow.document" as const,
      schemaVersion: 1 as const,
      document: authored(),
      source,
      exportedAt: "now",
      contentHash: "a".repeat(64),
    },
    model = new WorkflowImportForm(scope),
    release = model.activate();
  model.text(JSON.stringify(exported));
  const ports: Pick<WorkflowApi, "reviewImport"> = {
    reviewImport: async (input) => ({
      token: "reviewed",
      scope,
      destination: { scope, kind: "ai", id: "example", location: input.destination },
      document: authored(),
      source,
      sourceHash: "a".repeat(64),
      destinationHash: "b".repeat(64),
      warnings: ["Not proof of authorship"],
      expiresAt: "later",
    }),
  };
  return { model, release, ports };
}
test("import review is separate from commit and changing destination invalidates its token", async () => {
  const f = fixture();
  await f.model.review(f.ports);
  expect(f.model.getSnapshot().review?.destination.location).toBe("repository");
  f.model.destination("host");
  const commitImport = vi.fn(async () => ({
    status: "committed" as const,
    receiptId: "receipt",
    entry: entry(),
    message: "Imported",
  }));
  expect(await f.model.commit({ commitImport })).toBeNull();
  expect(commitImport).not.toHaveBeenCalled();
  f.release();
});
test("unknown import acknowledgment blocks replay and retains operation identity for receipt inspection", async () => {
  const f = fixture();
  await f.model.review(f.ports);
  const operation = f.model.getSnapshot().operationId,
    commitImport = vi.fn(async () => {
      throw new Error("Disconnected after write");
    });
  await f.model.commit({ commitImport });
  await f.model.commit({ commitImport });
  expect(commitImport).toHaveBeenCalledOnce();
  expect(f.model.getSnapshot()).toMatchObject({
    blocked: true,
    operationId: operation,
    error: "Disconnected after write",
  });
  f.release();
});
test("a hidden import success cannot navigate or allow a second commit", async () => {
  const f = fixture(),
    pending = deferred<Awaited<ReturnType<WorkflowApi["commitImport"]>>>();
  await f.model.review(f.ports);
  const commitImport = vi.fn(() => pending.promise),
    committing = f.model.commit({ commitImport });
  f.release();
  const release = f.model.activate();
  pending.resolve({
    status: "committed",
    receiptId: "receipt",
    entry: entry(),
    message: "Imported",
  });
  expect(await committing).toBeNull();
  expect(f.model.getSnapshot().blocked).toBe(true);
  expect(commitImport).toHaveBeenCalledOnce();
  release();
});
test("malformed import data produces an editable error without sending a host action", async () => {
  const f = fixture(),
    reviewImport = vi.fn(f.ports.reviewImport);
  f.model.text("broken");
  await f.model.review({ reviewImport });
  expect(reviewImport).not.toHaveBeenCalled();
  expect(f.model.getSnapshot().blocked).toBe(false);
  expect(f.model.getSnapshot().error.length).toBeGreaterThan(0);
  f.release();
});
test("previous operation inspection never grants permission to replay its import", async () => {
  const f = fixture();
  await f.model.review(f.ports);
  f.model.receipt("retained-operation");
  const commitImport = vi.fn();
  expect(await f.model.commit({ commitImport })).toBeNull();
  expect(commitImport).not.toHaveBeenCalled();
  expect(f.model.getSnapshot()).toMatchObject({
    operationId: "retained-operation",
    blocked: true,
    review: null,
  });
  f.release();
});
