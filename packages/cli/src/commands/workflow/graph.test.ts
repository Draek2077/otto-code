import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OrchestrationGraph } from "@otto-code/protocol/workflow";
import {
  parseGraphInputAssignments,
  loadWorkflowGraphExportFile,
  parseWorkflowGraphRunInput,
  resolveWorkflowGraphInputs,
  runWorkflowGraphValidateCommand,
} from "./graph.js";

const graph: OrchestrationGraph = {
  id: "brief-to-decision",
  name: "Brief to decision",
  inputs: [
    { key: "question", label: "Question", required: true },
    { key: "audience", label: "Audience", defaultValue: "Engineering" },
  ],
  nodes: [{ id: "root", kind: "orchestrator", title: "Orchestrator" }],
};

function captureError(action: () => unknown): unknown {
  try {
    action();
    return null;
  } catch (error) {
    return error;
  }
}

describe("Workflow Graph CLI input", () => {
  it("validates a local additive Graph document without a daemon, import, or execution", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otto-workflow-graph-"));
    const file = join(directory, "graph.json");
    await writeFile(
      file,
      JSON.stringify({ ...graph, futureDocumentField: { preserved: true } }),
      "utf8",
    );

    try {
      await expect(
        runWorkflowGraphValidateCommand(file, {}, undefined as never),
      ).resolves.toMatchObject({
        type: "single",
        data: {
          file,
          valid: true,
          scope: "structural",
          nodes: 1,
          edges: 0,
          warnings: [],
          diagnostics: [expect.objectContaining({ code: "GRAPH_DOCUMENT_LEGACY_UNVERSIONED" })],
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports an actionable structural validation failure for a local Graph document", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otto-workflow-graph-"));
    const file = join(directory, "invalid-graph.json");
    await writeFile(file, JSON.stringify({ ...graph, nodes: [] }), "utf8");

    try {
      await expect(
        runWorkflowGraphValidateCommand(file, {}, undefined as never),
      ).rejects.toMatchObject({
        code: "WORKFLOW_GRAPH_NOT_STRUCTURALLY_VALID",
        message: `Graph ${file} is not structurally valid`,
        details: ["The graph needs exactly one Orchestrator node (the root)."],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a newer portable Graph document with upgrade recovery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otto-workflow-graph-"));
    const file = join(directory, "newer-graph.json");
    await writeFile(
      file,
      JSON.stringify({
        ...graph,
        format: "otto.workflow.graph",
        formatVersion: 2,
      }),
      "utf8",
    );

    try {
      await expect(
        runWorkflowGraphValidateCommand(file, {}, undefined as never),
      ).rejects.toMatchObject({
        code: "WORKFLOW_GRAPH_DOCUMENT_INVALID",
        diagnostics: [
          expect.objectContaining({
            code: "GRAPH_DOCUMENT_VERSION_UNSUPPORTED",
            recovery: expect.stringContaining("Update Otto"),
          }),
        ],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a corrupt Graph export before it reaches a daemon", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otto-workflow-graph-export-"));
    const file = join(directory, "corrupt-export.json");
    await writeFile(file, "{not-json", "utf8");
    try {
      await expect(loadWorkflowGraphExportFile(file)).rejects.toMatchObject({
        code: "WORKFLOW_GRAPH_EXPORT_INVALID_JSON",
        message: `Graph export ${file} is not valid JSON`,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts repeated key=value graph inputs without splitting values again", () => {
    expect(parseGraphInputAssignments(["question=Ship=it?", "audience=Leadership"])).toEqual({
      question: "Ship=it?",
      audience: "Leadership",
    });
  });

  it("rejects malformed and duplicate graph inputs", () => {
    expect(captureError(() => parseGraphInputAssignments(["question"]))).toMatchObject({
      code: "INVALID_GRAPH_INPUT",
    });
    expect(
      captureError(() => parseGraphInputAssignments(["question=a", "question=b"])),
    ).toMatchObject({ code: "DUPLICATE_GRAPH_INPUT" });
  });

  it("uses declared defaults and rejects missing or unknown inputs before a run starts", () => {
    expect(resolveWorkflowGraphInputs(graph, { question: "Should we ship?" })).toEqual({
      question: "Should we ship?",
      audience: "Engineering",
    });
    expect(captureError(() => resolveWorkflowGraphInputs(graph, {}))).toMatchObject({
      code: "MISSING_GRAPH_INPUT",
    });
    expect(
      captureError(() => resolveWorkflowGraphInputs(graph, { question: "yes", extra: "no" })),
    ).toMatchObject({ code: "UNKNOWN_GRAPH_INPUT" });
  });

  it("requires an explicit remote cwd and one unambiguous orchestrator seat", () => {
    expect(
      captureError(() => parseWorkflowGraphRunInput(graph.id, { host: "remote.example" })),
    ).toMatchObject({
      code: "MISSING_CWD",
    });
    expect(
      captureError(() =>
        parseWorkflowGraphRunInput(graph.id, {
          orchestratorProfile: "orchestrator",
          orchestratorProvider: "mock",
        }),
      ),
    ).toMatchObject({ code: "CONFLICTING_ORCHESTRATOR_SEAT" });
  });

  it("preserves an explicit workspace ID for a remote Graph run", () => {
    expect(
      parseWorkflowGraphRunInput(graph.id, {
        host: "remote.example",
        cwd: "/workspace",
        workspace: "ws-1",
      }),
    ).toMatchObject({ cwd: "/workspace", workspaceId: "ws-1" });
  });
});
