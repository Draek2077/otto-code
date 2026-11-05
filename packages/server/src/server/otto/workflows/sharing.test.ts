import { beforeEach, afterEach, describe, test, expect, vi } from "vitest";
import { readdir } from "node:fs/promises";
import { workflowHostFixture } from "./test-utils/host-fixture.js";
import { aiDocument } from "./test-utils/fixture.js";
import { WorkflowSharing } from "./sharing.js";
import { WorkflowGraphExportSchema } from "@getpaseo/plugin/otto/workflows";
import { graphHash } from "./graph-identity.js";
describe("reviewed portable Workflow copies", () => {
  let f: Awaited<ReturnType<typeof workflowHostFixture>>;
  let sharing: WorkflowSharing;
  beforeEach(async () => {
    f = await workflowHostFixture();
    sharing = new WorkflowSharing(f.library);
  });
  afterEach(async () => {
    sharing.close();
    await f.cleanup();
  });
  async function source() {
    if (f.graph.kind !== "graph") throw new Error("Fixture");
    const entry = await f.library.write(
      f.scope,
      { kind: "graph", value: { ...f.graph.graph, id: "portable" } },
      null,
    );
    return { entry, exported: WorkflowGraphExportSchema.parse(await sharing.export(entry.ref)) };
  }
  test("Graph 0.9 package format stays portable; review is inert and confirmed copy verifies without execution", async () => {
    const { entry, exported } = await source();
    expect(exported.schemaVersion).toBe(1);
    expect(exported.graph).not.toHaveProperty("workflowStorage");
    const review = await sharing.review({
      scope: f.scope,
      exported,
      destination: "host",
      operationId: "import",
    });
    expect(await readdir(f.home)).toEqual([]);
    expect(f.agents.size).toBe(0);
    expect(review.warnings.join(" ")).toContain("do not prove authorship");
    const imported = await sharing.commit(f.scope, review.token, "import");
    expect(imported.status).toBe("committed");
    expect(await sharing.inspect(f.scope, "import")).toMatchObject({
      recordedAt: expect.any(String),
      actorHostId: f.scope.hostId,
    });
    expect(f.agents.size).toBe(0);
    expect(await f.library.read(entry.ref)).toEqual(entry);
    expect(await sharing.commit(f.scope, review.token, "import")).toEqual(
      expect.objectContaining({ status: "committed" }),
    );
  });
  test("tamper, unsafe ids and future versions are refused without a write", async () => {
    const { exported } = await source();
    const altered = structuredClone(exported);
    altered.graph.name = "Changed";
    await expect(
      sharing.review({
        scope: f.scope,
        exported: altered,
        destination: "host",
        operationId: "tamper",
      }),
    ).rejects.toThrow("content hash");
    altered.graph.id = "../outside";
    altered.contentHash = graphHash(altered.graph);
    await expect(
      sharing.review({
        scope: f.scope,
        exported: altered,
        destination: "host",
        operationId: "unsafe",
      }),
    ).rejects.toMatchObject({ kind: "invalid" });
    const future = structuredClone(exported);
    future.graph.formatVersion = 2;
    future.contentHash = graphHash(future.graph);
    await expect(
      sharing.review({
        scope: f.scope,
        exported: future,
        destination: "host",
        operationId: "future",
      }),
    ).rejects.toThrow("newer");
    expect(await readdir(f.home)).toEqual([]);
  });
  test("a self-attested hash never grants code, query, model or agent execution authority", async () => {
    const { exported } = await source();
    exported.graph.nodes[1].queryTools = [
      {
        name: "approved_later",
        description: "Host action",
        kind: "command",
        command: ["anything"],
      },
    ];
    exported.contentHash = graphHash(exported.graph);
    const review = await sharing.review({
      scope: f.scope,
      exported,
      destination: "host",
      operationId: "code",
    });
    await sharing.commit(f.scope, review.token, "code");
    expect(f.agents.size).toBe(0);
    await expect(
      f.host.review(
        f.scope,
        "workspace-1",
        { ...f.graph, kind: "graph", graph: exported.graph },
        "execute",
      ),
    ).rejects.toThrow("explicit approval");
  });
  test("definition kind collisions and peer changes cannot overwrite a destination", async () => {
    const { exported } = await source();
    const ai = aiDocument("portable");
    const existing = await f.library.write(f.scope, ai, null, undefined, "host");
    await expect(
      sharing.review({ scope: f.scope, exported, destination: "host", operationId: "collision" }),
    ).rejects.toThrow("already has");
    const review = await sharing.review({
      scope: f.scope,
      exported,
      destination: "host",
      operationId: "new-name",
      newId: "renamed",
    });
    await f.library.write(f.scope, aiDocument("renamed"), null, undefined, "host");
    await expect(sharing.commit(f.scope, review.token, "new-name")).rejects.toThrow(
      "Destination changed",
    );
    expect(await f.library.read(existing.ref)).toEqual(existing);
  });
  test("template/AI exports preserve authored settings while removing host storage identity", async () => {
    const ai = await f.library.write(f.scope, aiDocument(), null);
    const exported = await sharing.export(ai.ref);
    const review = await sharing.review({
      scope: f.scope,
      exported,
      destination: "host",
      operationId: "ai-copy",
    });
    expect(review.document.kind).toBe("ai");
    const copied = await sharing.commit(f.scope, review.token, "ai-copy");
    expect(copied.status).toBe("committed");
    expect(f.agents.size).toBe(0);
    const template = await f.library.write(
      f.scope,
      {
        kind: "template",
        value: {
          id: "prompt",
          name: "Prompt",
          content: "<% throw new Error('not executed') %>",
          future: { keep: true },
        },
      },
      null,
    );
    const prompt = await sharing.review({
      scope: f.scope,
      exported: await sharing.export(template.ref),
      destination: "host",
      operationId: "prompt-copy",
    });
    expect(prompt.document.value).toMatchObject({ future: { keep: true } });
    await sharing.commit(f.scope, prompt.token, "prompt-copy");
    expect(f.agents.size).toBe(0);
  });
  test("an unknown publication outcome is inspected/reconciled without repeating the document write", async () => {
    const { exported } = await source();
    const review = await sharing.review({
      scope: f.scope,
      exported,
      destination: "host",
      operationId: "unknown",
    });
    const write = vi.spyOn(f.library, "write"),
      read = vi
        .spyOn(f.library, "read")
        .mockRejectedValueOnce(new Error("Verification unavailable"));
    expect(await sharing.commit(f.scope, review.token, "unknown")).toMatchObject({
      status: "reconciliation_required",
    });
    read.mockRestore();
    const inspection = await sharing.inspect(f.scope, "unknown");
    expect(inspection).toMatchObject({ matches: true, status: "reconciliation_required" });
    expect(
      await sharing.reconcile({
        scope: f.scope,
        operationId: "unknown",
        expectedRevision: inspection.revision,
        expectedDocumentRevision: inspection.currentRevision!,
      }),
    ).toMatchObject({ status: "committed" });
    expect(write).toHaveBeenCalledTimes(1);
    write.mockRestore();
  });
  test("foreign or changed operation scope cannot redeem the reviewed copy", async () => {
    const { exported } = await source();
    const review = await sharing.review({
      scope: f.scope,
      exported,
      destination: "host",
      operationId: "bound",
    });
    await expect(
      sharing.commit({ ...f.scope, projectId: "project-2" }, review.token, "bound"),
    ).rejects.toThrow("different content/scope");
    await expect(sharing.commit(f.scope, review.token, "other")).rejects.toThrow(
      "different content/scope",
    );
    expect(f.agents.size).toBe(0);
  });
});
