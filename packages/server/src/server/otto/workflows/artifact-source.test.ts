import { test, expect } from "vitest";
import { workflowArtifactSource, unwrapWorkflowResult } from "@getpaseo/plugin/otto/workflows";
import { workflowHostFixture } from "./test-utils/host-fixture.js";
import { createWorkflowArtifactPort } from "./artifact-source.js";
import { ArtifactDaemonService } from "../artifacts/service.js";
test("Artifacts derive Workflow source from a live reserved owner and retain exact source inspection", async () => {
  const f = await workflowHostFixture(),
    workflows = createWorkflowArtifactPort(
      () => f.host,
      () => f.library,
    );
  const service = new ArtifactDaemonService({
    home: f.home,
    hostId: f.scope.hostId,
    metadata: f.metadata,
    workspaces: { get: async () => ({ projectId: f.scope.projectId, archivedAt: null }) },
    projects: async () => [{ projectId: f.scope.projectId, archivedAt: null }],
    workflows,
    generation: async () => ({
      provider: "fixture",
      model: "fixture",
      html: '<!doctype html><html><head><title>Report</title></head><body><h1>Report</h1><script id="otto-artifact-data" type="application/json">{}</script></body></html>',
    }),
  });
  try {
    const entry = await f.start(),
      agentId = String(entry.document.value.conductorAgentId),
      source = await service.callerSource({ agentId, workspaceId: "workspace-1" });
    expect(source).toEqual({ kind: "workflow", workflowId: "ai-example", runId: entry.ref.id });
    const scope = {
      hostId: f.scope.hostId,
      target: { kind: "project" as const, id: f.scope.projectId },
    };
    const artifact = await service.create(
      { scope, name: "Workflow report", description: "Result" },
      source,
    );
    const value = unwrapWorkflowResult(
      workflowArtifactSource.output.parse(
        await service.invoke(workflowArtifactSource.name, {
          scope,
          id: artifact.id,
          location: artifact.location,
        }),
      ),
    );
    expect(value).toMatchObject({
      kind: "workflow",
      ref: entry.ref,
      title: "Example AI",
      status: "planning",
      workspaceId: "workspace-1",
      conductorAgentId: agentId,
    });
    expect(
      await workflows.caller({
        agentId: "unrelated-chat",
        workspaceId: "workspace-1",
        labels: { "otto.orchestration-run-id": entry.ref.id },
      }),
    ).toBeUndefined();
    expect(await workflows.caller({ agentId, workspaceId: "other-workspace" })).toBeUndefined();
  } finally {
    await service.close();
    await f.cleanup();
  }
});
test("duplicate historical origins are not silently chosen for an Artifact source", async () => {
  const f = await workflowHostFixture(),
    port = createWorkflowArtifactPort(
      () => f.host,
      () => f.library,
    );
  try {
    const entry = await f.start();
    await f.host.control(entry.ref, entry.revision, "cancel");
    await f.host.settled(entry.ref);
    const settled = await f.library.read(entry.ref);
    await f.library.write(f.scope, settled.document, null, undefined, "host");
    expect(await port.read(f.scope, entry.ref.id)).toBeNull();
    expect(
      await port.caller({
        agentId: String(entry.document.value.conductorAgentId),
        workspaceId: "workspace-1",
      }),
    ).toBeUndefined();
  } finally {
    await f.cleanup();
  }
});
