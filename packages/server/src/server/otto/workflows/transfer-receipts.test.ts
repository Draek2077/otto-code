import { beforeEach, afterEach, test, expect, vi } from "vitest";
import path from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { workflowFixture, graphDocument } from "./test-utils/fixture.js";
import { WorkflowTransfers } from "./transfers.js";
import { WorkflowTransferReceipts } from "./transfer-receipts.js";
let f: Awaited<ReturnType<typeof workflowFixture>>;
beforeEach(async () => {
  f = await workflowFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await f.cleanup();
});
async function interrupted() {
  const source = await f.library.write(f.scope, graphDocument(), null);
  vi.spyOn(f.library, "remove").mockRejectedValueOnce(new Error("injected retirement denial"));
  const receipt = await new WorkflowTransfers(f.library).transfer({
    source: source.ref,
    expectedRevision: source.revision,
    destination: "host",
    operation: "move",
    operationId: "interrupted",
  });
  expect(receipt.status).toBe("reconciliation_required");
  const receipts = new WorkflowTransferReceipts(f.library);
  return { source, receipt, receipts, inspection: await receipts.inspect(f.scope, receipt.id) };
}
test("exact inspected destination completes a move without copying or generating again", async () => {
  const { source, receipt, receipts, inspection } = await interrupted();
  const write = vi.spyOn(f.library, "write");
  expect(inspection).toMatchObject({
    sourceMatches: true,
    destinationMatches: true,
    proofAvailable: true,
  });
  const final = await receipts.reconcile({
    scope: f.scope,
    operationId: receipt.id,
    expectedRevision: inspection.revision!,
    expectedSourceRevision: inspection.sourceRevision,
    expectedDestinationRevision: inspection.destinationRevision!,
    decision: "complete_move",
    confirmed: true,
  });
  expect(final.receipt?.status).toBe("committed");
  await expect(f.library.read(source.ref)).rejects.toMatchObject({ kind: "unavailable" });
  expect(write).not.toHaveBeenCalled();
});
test("peer-edited source is never retired; an explicit verified copy preserves both records", async () => {
  const { source, receipt, receipts } = await interrupted();
  const changed = graphDocument();
  changed.value.name = "Peer edit";
  const peer = await f.library.write(f.scope, changed, source.revision, source.ref);
  const inspection = await receipts.inspect(f.scope, receipt.id);
  const input = {
    scope: f.scope,
    operationId: receipt.id,
    expectedRevision: inspection.revision!,
    expectedSourceRevision: inspection.sourceRevision,
    expectedDestinationRevision: inspection.destinationRevision!,
    confirmed: true as const,
  };
  await expect(receipts.reconcile({ ...input, decision: "complete_move" })).rejects.toMatchObject({
    kind: "conflict",
  });
  expect((await receipts.reconcile({ ...input, decision: "keep_copy" })).receipt?.operation).toBe(
    "copy",
  );
  expect(await f.library.read(source.ref)).toEqual(peer);
  expect((await f.library.read(receipt.destination)).document.value.name).toBe("Example Graph");
});
test("changed receipt or destination digest refuses reconciliation", async () => {
  const { receipt, receipts, inspection } = await interrupted();
  const input = {
    scope: f.scope,
    operationId: receipt.id,
    expectedRevision: inspection.revision!,
    expectedSourceRevision: inspection.sourceRevision,
    expectedDestinationRevision: inspection.destinationRevision!,
    decision: "keep_copy" as const,
    confirmed: true as const,
  };
  await expect(receipts.reconcile({ ...input, expectedRevision: "stale" })).rejects.toMatchObject({
    kind: "conflict",
  });
  const destination = await f.library.read(receipt.destination);
  destination.document.value.name = "Changed destination";
  await f.library.write(f.scope, destination.document, destination.revision, destination.ref);
  await expect(receipts.reconcile(input)).rejects.toMatchObject({ kind: "conflict" });
  expect((await receipts.inspect(f.scope, receipt.id)).destinationMatches).toBe(false);
});
test("exact orphan receipt lock is retained before recovery; stale fingerprints are refused", async () => {
  const { receipt, receipts } = await interrupted();
  const directory = path.join(f.home, "workflow-transfers");
  await mkdir(path.join(directory, `${receipt.id}.json.transaction.otto-lock`));
  const inspection = await receipts.inspect(f.scope, receipt.id);
  expect(inspection.lock?.canRecover).toBe(true);
  await expect(
    receipts.recoverLock(f.scope, receipt.id, inspection.revision, "wrong"),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(
    (
      await receipts.recoverLock(
        f.scope,
        receipt.id,
        inspection.revision,
        inspection.lock!.revision,
      )
    ).lock,
  ).toBeNull();
  expect(
    (await readdir(directory)).some((name) => name.startsWith(".recovery-workflow-lock-")),
  ).toBe(true);
});
