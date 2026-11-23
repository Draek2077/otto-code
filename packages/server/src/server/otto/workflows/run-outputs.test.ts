import { beforeEach, afterEach, describe, test, expect } from "vitest";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { workflowFixture } from "./test-utils/fixture.js";
import { WorkflowRunOutputs } from "./run-outputs.js";
import { WorkflowTransfers } from "./transfers.js";
import type { WorkflowRunRecord, WorkflowEntry } from "@getpaseo/plugin/otto/workflows";
import { workflowDigest } from "./files.js";
function resultRun(count = 1): WorkflowRunRecord {
  return {
    id: "result-run",
    title: "Results",
    status: "done",
    phases: Array.from({ length: count }, (_, index) => ({
      id: `phase-${index}`,
      type: "execute",
      title: `Phase ${index}`,
      task: "界".repeat(4000),
      status: "done",
      candidates: [
        {
          agentId: `agent-${index}`,
          summary: "界".repeat(20000),
          outputFields: { answer: "Actual " + "x".repeat(15000) },
          verdict: {
            verdict: "pass",
            criteria: [
              { name: "Preserve the full result", met: true, evidence: "Precise evidence" },
            ],
          },
        },
      ],
    })),
  };
}
function runValue(entry: WorkflowEntry) {
  if (entry.document.kind !== "run") throw new Error("Fixture");
  return entry.document.value;
}
describe("immutable Workflow result references", () => {
  let f: Awaited<ReturnType<typeof workflowFixture>>;
  let outputs: WorkflowRunOutputs;
  beforeEach(async () => {
    f = await workflowFixture();
    outputs = new WorkflowRunOutputs(f.library);
  });
  afterEach(async () => {
    await f.cleanup();
  });
  async function empty() {
    return f.library.write(
      f.scope,
      { kind: "run", value: { id: "result-run", title: "Results", status: "done", phases: [] } },
      null,
    );
  }
  test("a 40-agent run retains full results without duplicating megabytes in each status response", async () => {
    const entry = await empty(),
      run = resultRun(39);
    run.agentCount = 40;
    const manifest = await outputs.capture(entry.ref, run);
    expect(Buffer.byteLength(JSON.stringify(run))).toBeGreaterThan(2 * 1024 * 1024);
    expect(Buffer.byteLength(JSON.stringify(manifest))).toBeLessThan(500000);
    const saved = await f.library.write(
      f.scope,
      { kind: "run", value: manifest },
      entry.revision,
      entry.ref,
    );
    const candidate = runValue(saved).phases[0].candidates![0];
    expect(candidate.outputFields).toBeUndefined();
    const full = await outputs.read(saved.ref, candidate.agentId, candidate.outputRevision!);
    expect(full.summary).toBe(run.phases[0].candidates![0].summary);
    expect(full.fields).toEqual(run.phases[0].candidates![0].outputFields);
    expect(full.verdict?.criteria?.[0].evidence).toBe("Precise evidence");
  });
  test("a newer result cannot clobber bytes referenced by the last durable manifest/snapshot", async () => {
    const entry = await empty(),
      run = resultRun();
    const first = await f.library.write(
      f.scope,
      { kind: "run", value: await outputs.capture(entry.ref, run) },
      entry.revision,
      entry.ref,
    );
    const before = runValue(first).phases[0].candidates![0];
    run.phases[0].candidates![0].summary = "New round";
    await outputs.capture(first.ref, run);
    expect((await outputs.read(first.ref, before.agentId, before.outputRevision!)).summary).toBe(
      "界".repeat(20000),
    );
    const file = path.join(f.repo, ".otto/workflows/runs/result-run.json");
    await writeFile(file, "{broken");
    const transfers = new WorkflowTransfers(f.library),
      review = await transfers.inspect(first.ref);
    await transfers.recover(first.ref, workflowDigest("{broken"), review.snapshotRevision!);
    expect((await outputs.read(first.ref, before.agentId, before.outputRevision!)).fields).toEqual({
      answer: "Actual " + "x".repeat(15000),
    });
  });
  test("storage transfer verifies/copies the referenced result bytes before retiring its manifest", async () => {
    const entry = await empty();
    const saved = await f.library.write(
      f.scope,
      { kind: "run", value: await outputs.capture(entry.ref, resultRun()) },
      entry.revision,
      entry.ref,
    );
    const receipt = await new WorkflowTransfers(f.library).transfer({
      source: saved.ref,
      expectedRevision: saved.revision,
      destination: "host",
      operation: "move",
      operationId: "move-results",
    });
    expect(receipt.status).toBe("committed");
    const copied = await f.library.read(receipt.destination),
      candidate = runValue(copied).phases[0].candidates![0];
    expect(
      (await outputs.read(copied.ref, candidate.agentId, candidate.outputRevision!)).summary,
    ).toBe("界".repeat(20000));
    await expect(f.library.read(saved.ref)).rejects.toMatchObject({ kind: "unavailable" });
  });
  test("foreign candidate and tampered result bytes cannot satisfy a recorded digest", async () => {
    const entry = await empty();
    const saved = await f.library.write(
      f.scope,
      { kind: "run", value: await outputs.capture(entry.ref, resultRun()) },
      entry.revision,
      entry.ref,
    );
    const candidate = runValue(saved).phases[0].candidates![0];
    await expect(outputs.read(saved.ref, "other", candidate.outputRevision!)).rejects.toMatchObject(
      { kind: "conflict" },
    );
    const file = path.join(
      f.repo,
      ".otto/workflows/runs/.otto-results/result-run",
      `${candidate.agentId}.${candidate.outputRevision}.json`,
    );
    await writeFile(file, "Peer changed bytes");
    await expect(
      outputs.read(saved.ref, candidate.agentId, candidate.outputRevision!),
    ).rejects.toThrow("missing or changed");
    expect(await f.library.read(saved.ref)).toEqual(saved);
  });
});
