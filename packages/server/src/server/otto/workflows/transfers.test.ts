import { beforeEach, afterEach, describe, test, expect, vi } from "vitest";
import path from "node:path";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { workflowFixture, graphDocument } from "./test-utils/fixture.js";
import { WorkflowTransfers } from "./transfers.js";
import { workflowDigest } from "./files.js";

describe("explicit Workflow transfer and recovery", () => {
  let f: Awaited<ReturnType<typeof workflowFixture>>;
  let service: WorkflowTransfers;
  beforeEach(async () => {
    f = await workflowFixture();
    service = new WorkflowTransfers(f.library);
  });
  afterEach(async () => {
    await f.cleanup();
  });
  test("verified copy preserves source, unknown fields, origin and settings", async () => {
    const original = await f.library.write(f.scope, graphDocument(), null);
    const receipt = await service.transfer({
      source: original.ref,
      expectedRevision: original.revision,
      destination: "host",
      operation: "copy",
      operationId: "copy-1",
    });
    expect(receipt.status).toBe("committed");
    expect(await f.library.read(original.ref)).toEqual(original);
    expect((await f.library.read(receipt.destination)).document.value).toMatchObject({
      future: { retained: true },
      workflowStorage: { location: "host" },
    });
    expect((await f.stores.storage(f.scope)).override).toBeNull();
  });
  test("verified move retains source recovery bytes and does not hide the destination", async () => {
    const original = await f.library.write(f.scope, graphDocument(), null);
    const receipt = await service.transfer({
      source: original.ref,
      expectedRevision: original.revision,
      destination: "host",
      operation: "move",
      operationId: "move-1",
    });
    expect(receipt.status).toBe("committed");
    await expect(f.library.read(original.ref)).rejects.toMatchObject({ kind: "unavailable" });
    expect((await f.library.list(f.scope, "graph")).items.map((i) => i.ref)).toEqual([
      receipt.destination,
    ]);
    const directory = path.join(f.repo, ".otto/workflows/definitions/.otto-recovery");
    expect(
      JSON.parse(await readFile(path.join(directory, (await readdir(directory))[0]), "utf8")),
    ).toEqual(original.document.value);
  });
  test("same operation replays its receipt, different content with that ID is refused", async () => {
    const original = await f.library.write(f.scope, graphDocument(), null);
    const input = {
      source: original.ref,
      expectedRevision: original.revision,
      destination: "host" as const,
      operation: "move" as const,
      operationId: "replay",
    };
    const receipt = await service.transfer(input);
    expect(await service.transfer(input)).toEqual(receipt);
    await expect(service.transfer({ ...input, operation: "copy" })).rejects.toMatchObject({
      kind: "conflict",
    });
  });
  test("stale source and destination collision preserve both records", async () => {
    const original = await f.library.write(f.scope, graphDocument(), null);
    await expect(
      service.transfer({
        source: original.ref,
        expectedRevision: "stale",
        destination: "host",
        operation: "move",
        operationId: "stale",
      }),
    ).rejects.toMatchObject({ kind: "conflict" });
    const peer = graphDocument();
    peer.value.name = "Host peer";
    const host = await f.library.write(f.scope, peer, null, undefined, "host");
    await expect(
      service.transfer({
        source: original.ref,
        expectedRevision: original.revision,
        destination: "host",
        operation: "copy",
        operationId: "collision",
      }),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect(await f.library.read(host.ref)).toEqual(host);
    expect(await f.library.read(original.ref)).toEqual(original);
  });
  test("unknown retirement outcome retains verified destination and reconciliation receipt without retry", async () => {
    const original = await f.library.write(f.scope, graphDocument(), null);
    const remove = vi.spyOn(f.library, "remove").mockRejectedValueOnce(new Error("injected"));
    const input = {
      source: original.ref,
      expectedRevision: original.revision,
      destination: "host" as const,
      operation: "move" as const,
      operationId: "denied",
    };
    const receipt = await service.transfer(input);
    expect(receipt.status).toBe("reconciliation_required");
    expect(await f.library.read(original.ref)).toEqual(original);
    expect((await f.library.read(receipt.destination)).document.kind).toBe("graph");
    expect(await service.transfer(input)).toEqual(receipt);
    expect(remove).toHaveBeenCalledTimes(1);
  });
  test("legacy copy assigns project origin without removing shared history", async () => {
    const directory = path.join(f.home, "orchestration-graphs");
    await mkdir(directory);
    const bytes = JSON.stringify(graphDocument("old").value);
    await writeFile(path.join(directory, "old.json"), bytes);
    const item = (await f.library.list(f.scope, "graph", 0, true)).items[0];
    await expect(
      service.transfer({
        source: item.ref,
        expectedRevision: item.revision,
        destination: "repository",
        operation: "move",
        operationId: "legacy-move",
      }),
    ).rejects.toMatchObject({ kind: "unsupported" });
    expect(
      (
        await service.transfer({
          source: item.ref,
          expectedRevision: item.revision,
          destination: "repository",
          operation: "copy",
          operationId: "legacy-copy",
        })
      ).status,
    ).toBe("committed");
    expect(await readFile(path.join(directory, "old.json"), "utf8")).toBe(bytes);
  });
  test("explicit digest-pinned recovery preserves damaged bytes and rejects stale review", async () => {
    const original = await f.library.write(f.scope, graphDocument(), null);
    const file = path.join(f.repo, ".otto/workflows/definitions/example.json");
    const damaged = "{broken";
    await writeFile(file, damaged);
    const review = await service.inspect(original.ref);
    if (!review.snapshotRevision) throw new Error("Missing snapshot");
    await expect(
      service.recover(original.ref, original.revision, review.snapshotRevision),
    ).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(await readFile(file, "utf8")).toBe(damaged);
    await expect(
      service.recover(original.ref, workflowDigest(damaged), "changed-snapshot"),
    ).rejects.toMatchObject({ kind: "conflict" });
    await service.recover(original.ref, workflowDigest(damaged), review.snapshotRevision);
    expect(await f.library.read(original.ref)).toEqual(original);
    expect(
      await readFile(
        path.join(
          path.dirname(file),
          ".otto-recovery",
          `example.${workflowDigest(damaged)}.damaged`,
        ),
        "utf8",
      ),
    ).toBe(damaged);
  });
});
