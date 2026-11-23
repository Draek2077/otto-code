import { describe, expect, test } from "vitest";
import {
  WorkflowSchema,
  normalizeWorkflow,
  validateGraphDocument,
  validateOrchestrationGraph,
} from "./model.js";
import {
  workflowSave,
  WorkflowRunRecord,
  normalizeWorkflowRunRecord,
  WorkflowRef,
  WorkflowFailure,
  workflowRead,
  unwrapWorkflowResult,
} from "./runtime.js";

describe("Workflow structural compatibility", () => {
  test("absent legacy phase arrays are normalized only after validation", () => {
    const original = { id: "old", title: "Old", status: "pending", future: { retain: 1 } };
    const wire = WorkflowSchema.parse(original);
    expect(wire.phases).toBeUndefined();
    const normalized = normalizeWorkflow(wire);
    expect(normalized.phases).toEqual([]);
    expect(normalized.future).toEqual({ retain: 1 });
    expect(original).not.toHaveProperty("phases");
  });
  test("unknown future status and metadata remain parseable", () => {
    const run = normalizeWorkflowRunRecord(
      WorkflowRunRecord.parse({
        id: "future",
        title: "Future",
        status: "future-wait",
        future: { retain: true },
      }),
    );
    expect(run).toMatchObject({ status: "future-wait", future: { retain: true }, phases: [] });
  });
  test("public authoring cannot write a fabricated run record", () => {
    expect(
      workflowSave.input.safeParse({
        scope: { hostId: "h", projectId: "p" },
        expectedRevision: null,
        document: { kind: "run", value: { id: "fake", title: "Fake", status: "done", phases: [] } },
      }).success,
    ).toBe(false);
  });
  test("unsupported portable versions are diagnosed before execution", () => {
    expect(
      validateGraphDocument({
        id: "g",
        name: "G",
        format: "otto.workflow.graph",
        formatVersion: 99,
        nodes: [],
      }),
    ).not.toEqual([]);
  });
  test("editing attempts retain the shared-checkout retry prohibition", () => {
    expect(
      validateOrchestrationGraph({
        id: "graph",
        name: "Graph",
        nodes: [
          { id: "root", kind: "orchestrator", title: "Root" },
          {
            id: "write",
            kind: "agent",
            title: "Write",
            prompt: "Edit",
            access: "write",
            retry: { maxAttempts: 2, backoffMs: 0 },
          },
        ],
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining("can't retry")]));
  });
  test("legacy dotted record identities remain valid while traversal and Windows device names are refused", () => {
    const ref = {
      scope: { hostId: "h", projectId: "p" },
      kind: "graph",
      location: "legacy",
      id: "review.v1",
    };
    expect(WorkflowRef.parse(ref).id).toBe("review.v1");
    for (const id of [".", "..", "../escape", "CON.txt", "lpt1.graph"])
      expect(WorkflowRef.safeParse({ ...ref, id }).success).toBe(false);
  });
  test("public RPC errors are classified, discriminated data and cannot masquerade as a successful record", () => {
    const response = workflowRead.output.parse({
      ok: false,
      error: { code: "conflict", message: "Refresh this record" },
    });
    expect(() => unwrapWorkflowResult(response)).toThrow("Refresh this record");
    expect(WorkflowFailure.safeParse({ code: "made-up", message: "x" }).success).toBe(false);
    expect(
      workflowRead.output.safeParse({ ok: true, error: { code: "conflict", message: "x" } })
        .success,
    ).toBe(false);
  });
});
