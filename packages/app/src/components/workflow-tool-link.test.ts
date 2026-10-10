import { describe, expect, it } from "vitest";
import { readStartedWorkflowRunId } from "./workflow-tool-link";

describe("readStartedWorkflowRunId", () => {
  it("reads the run id from a start_workflow result in any envelope", () => {
    expect(
      readStartedWorkflowRunId("mcp__otto__start_workflow", {
        structuredContent: { runId: "run_muy5zbrd_83cd2e9f", status: "done" },
      }),
    ).toBe("run_muy5zbrd_83cd2e9f");
    expect(
      readStartedWorkflowRunId(
        "mcp__otto__start_workflow",
        '{"runId":"run_abc123_00ff","status":"paused"}',
      ),
    ).toBe("run_abc123_00ff");
  });

  it("ignores every other tool, and a call that has not returned", () => {
    expect(
      readStartedWorkflowRunId("mcp__otto__get_workflow_status", { runId: "run_a1_ff" }),
    ).toBeNull();
    expect(readStartedWorkflowRunId("mcp__otto__start_workflow", null)).toBeNull();
  });
});
