import { describe, expect, it } from "vitest";

import { MutableProjectWorkflowsConfigSchema } from "./daemon-config.js";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";
import {
  OrchestrationGraphSchema,
  PromptTemplateSchema,
  WorkflowGraphExportSchema,
  WorkflowSchema,
} from "./workflow.js";

describe("Workflow storage protocol additions", () => {
  it("represents an independent host default", () => {
    expect(MutableProjectWorkflowsConfigSchema.parse({})).toEqual({
      defaultStoreLocation: "repository",
    });
    expect(MutableProjectWorkflowsConfigSchema.parse({ defaultStoreLocation: "host" })).toEqual({
      defaultStoreLocation: "host",
    });
  });

  it("keeps provenance additive for legacy Workflow records", () => {
    expect(
      WorkflowSchema.parse({ id: "run_1", title: "Legacy", status: "done", phases: [] }),
    ).not.toHaveProperty("workflowStorage");
    expect(
      OrchestrationGraphSchema.parse({ id: "graph_1", name: "Legacy", nodes: [] }),
    ).not.toHaveProperty("workflowStorage");
    expect(
      PromptTemplateSchema.parse({ id: "template_1", name: "Legacy", content: "Hi" }),
    ).not.toHaveProperty("workflowStorage");
    const provenance = {
      schemaVersion: 1,
      projectRoot: "C:/work/project",
      location: "repository" as const,
      storeKey: "workflows:repository:stable-key",
      source: "project-store" as const,
    };
    expect(
      WorkflowSchema.parse({
        id: "run_2",
        title: "Scoped",
        status: "done",
        phases: [],
        workflowStorage: provenance,
      }).workflowStorage,
    ).toEqual(provenance);
    expect(
      OrchestrationGraphSchema.parse({
        id: "graph_2",
        name: "Scoped",
        nodes: [],
        workflowStorage: provenance,
      }).workflowStorage,
    ).toEqual(provenance);
    expect(
      PromptTemplateSchema.parse({
        id: "template_2",
        name: "Scoped",
        content: "Hi",
        workflowStorage: provenance,
      }).workflowStorage,
    ).toEqual(provenance);
  });

  it("accepts the capability gate only when a host declares supported categories", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "host_1",
        version: "0.9.0",
        features: { categoryStorageResolver: { categories: ["workflows"] } },
      }).features.categoryStorageResolver,
    ).toEqual({ categories: ["workflows"] });
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "host_legacy",
        version: "0.8.19",
        features: {},
      }).features.categoryStorageResolver,
    ).toBeUndefined();
  });

  it("keeps the project Workflow setting pair structural and optional for old peers", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "project.workflow.store.set.request",
        projectId: "project_1",
        location: "host",
        requestId: "request_1",
      }),
    ).toMatchObject({ projectId: "project_1", location: "host" });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "project.workflow.store.set.response",
        payload: {
          projectId: "project_1",
          accepted: true,
          error: null,
          requestId: "request_1",
        },
      }),
    ).toMatchObject({ payload: { accepted: true } });
    expect(
      WorkflowSchema.parse({ id: "legacy", title: "Legacy", status: "done", phases: [] }),
    ).not.toHaveProperty("workflowStorage");
  });

  it("keeps portable Graph export envelopes structural and compatible", () => {
    const exported = WorkflowGraphExportSchema.parse({
      schemaVersion: 1,
      graph: {
        format: "otto.workflow.graph",
        formatVersion: 1,
        id: "graph_1",
        name: "Shared",
        nodes: [{ id: "root", kind: "orchestrator", title: "Root" }],
      },
      source: {
        storeKey: "workflows:legacy-host-library",
        location: "host",
        source: "legacy-host-library",
      },
      exportedAt: "2026-08-29T00:00:00.000Z",
      contentHash: "a".repeat(64),
    });
    expect(exported.graph.formatVersion).toBe(1);
    expect(() => WorkflowGraphExportSchema.parse({ ...exported, schemaVersion: 2 })).toThrow();
  });

  it("addresses project Workflow transfers by record id and scope, never a private path", () => {
    const request = SessionInboundMessageSchema.parse({
      type: "workflows.storage.transfer.request",
      cwd: "C:/work/project",
      recordKind: "graph",
      recordId: "graph_1",
      source: "legacy-host-library",
      destination: "repository",
      mode: "copy",
      requestId: "request_2",
    });
    expect(request).toMatchObject({ recordId: "graph_1", destination: "repository" });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "workflows.storage.transfer.response",
        payload: {
          receipt: {
            schemaVersion: 1,
            receiptId: "receipt_1",
            recordKind: "graph",
            recordId: "graph_1",
            mode: "copy",
            source: { source: "legacy-host-library", storeKey: "workflows:legacy-host-library" },
            destination: { location: "repository", storeKey: "workflows:repository:id:project_1" },
            contentHash: "b".repeat(64),
            status: "verified",
            createdAt: "2026-08-29T00:00:00.000Z",
            updatedAt: "2026-08-29T00:00:00.000Z",
          },
          requestId: "request_2",
        },
      }),
    ).toMatchObject({ payload: { receipt: { status: "verified" } } });
  });
});
