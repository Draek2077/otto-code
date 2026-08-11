import { describe, expect, it } from "vitest";
import {
  ProjectKnowledgeCreateRequestMessageSchema,
  ProjectKnowledgeDeleteRequestMessageSchema,
  ProjectKnowledgeProjectApplyRequestMessageSchema,
  ProjectKnowledgeRecordSchema,
  ProjectKnowledgeReferenceApplyRequestMessageSchema,
  ProjectKnowledgeRootApplyRequestMessageSchema,
} from "./messages.js";

describe("project knowledge protocol", () => {
  it("accepts rich Markdown and an optional human slug", () => {
    const statement = `# Runtime\n\n${"rich content\n".repeat(200)}\n[[provider-neutral-tools]]`;
    expect(
      ProjectKnowledgeCreateRequestMessageSchema.parse({
        type: "project.knowledge.create.request",
        requestId: "request-1",
        workspaceId: "workspace-1",
        id: "provider-neutral-tools",
        kind: "architecture",
        title: "Provider-neutral tools",
        statement,
      }).statement,
    ).toBe(statement);
  });

  it("accepts an unresolved finding as a normal knowledge kind", () => {
    expect(
      ProjectKnowledgeCreateRequestMessageSchema.safeParse({
        type: "project.knowledge.create.request",
        requestId: "request-finding",
        workspaceId: "workspace-1",
        kind: "finding",
        title: "Unexpected retry burst",
        statement:
          "We observed the burst but do not yet know its cause or whether it needs action.",
      }).success,
    ).toBe(true);
  });

  it("keeps old records parseable while allowing timeline metadata and paths", () => {
    const base = {
      id: "daemon-owns-memory",
      kind: "decision" as const,
      title: "Daemon owns memory",
      statement: "The daemon owns writes.",
      tags: [],
      status: "confirmed" as const,
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z",
    };
    expect(ProjectKnowledgeRecordSchema.safeParse(base).success).toBe(true);
    expect(
      ProjectKnowledgeRecordSchema.safeParse({
        ...base,
        path: ".otto/knowledge/decisions/daemon-owns-memory.md",
        provenance: [
          {
            kind: "decision",
            text: "Knowledge page created.",
            recordedAt: base.createdAt,
            affects: ["architecture"],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("adds optional project and reference metadata without breaking old records", () => {
    expect(
      ProjectKnowledgeRecordSchema.safeParse({
        id: "knowledge-ui",
        kind: "project",
        title: "Knowledge UI",
        statement: "Make project knowledge manageable.",
        tags: [],
        status: "confirmed",
        deliveryStatus: "in_build",
        progress: { completed: 4, total: 10, unit: "milestones" },
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      ProjectKnowledgeRecordSchema.safeParse({
        id: "brain-md",
        kind: "reference",
        title: "Brain.md",
        statement: "External design reference.",
        tags: [],
        status: "confirmed",
        referenceDisposition: "adopted",
        sourceUrl: "https://example.test/brain-md",
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("supports finding records without narrowing older record shapes", () => {
    expect(
      ProjectKnowledgeRecordSchema.safeParse({
        id: "finding-runtime-cost",
        kind: "finding",
        title: "Runtime cost investigation",
        statement: "Measured evidence.",
        tags: ["finding", "performance"],
        status: "confirmed",
        createdAt: "2026-08-11T00:00:00.000Z",
        updatedAt: "2026-08-11T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("uses reasoned namespaced RPCs for project delivery and reference evaluation", () => {
    expect(
      ProjectKnowledgeProjectApplyRequestMessageSchema.safeParse({
        type: "project.knowledge.project.apply.request",
        requestId: "request-project",
        workspaceId: "workspace-1",
        id: "knowledge-ui",
        deliveryStatus: "partial",
        progress: { completed: 6, total: 10, unit: "milestones" },
        reason: "Six milestones now pass review.",
      }).success,
    ).toBe(true);
    expect(
      ProjectKnowledgeReferenceApplyRequestMessageSchema.safeParse({
        type: "project.knowledge.reference.apply.request",
        requestId: "request-reference",
        workspaceId: "workspace-1",
        id: "brain-md",
        disposition: "adopted",
        reason: "Its page model shaped this design.",
      }).success,
    ).toBe(true);
  });

  it("uses a namespaced root-page write RPC", () => {
    expect(
      ProjectKnowledgeRootApplyRequestMessageSchema.safeParse({
        type: "project.knowledge.root.apply.request",
        requestId: "request-2",
        workspaceId: "workspace-1",
        slug: "mindmap",
        body: "# Mindmap\n\n- [[daemon-owns-memory]]",
      }).success,
    ).toBe(true);
  });

  it("requires a reason on the namespaced permanent-delete RPC", () => {
    expect(
      ProjectKnowledgeDeleteRequestMessageSchema.safeParse({
        type: "project.knowledge.delete.request",
        requestId: "request-3",
        workspaceId: "workspace-1",
        id: "test",
        reason: "The user identified this as accidental fixture data.",
      }).success,
    ).toBe(true);
  });
});
