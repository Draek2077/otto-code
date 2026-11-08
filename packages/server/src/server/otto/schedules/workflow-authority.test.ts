import { expect, test } from "vitest";
import {
  AiWorkflowDefinition,
  OrchestrationGraphSchema,
  DEFAULT_WORKFLOW_LIMITS,
  type WorkflowLaunch,
} from "@getpaseo/plugin/otto/workflows";
import type { ScheduleTarget } from "./types.js";
import { workflowScheduleAuthority } from "./workflow-authority.js";
const seats = {
  conductor: { provider: "fixture", model: "selected" },
  worker: { provider: "fixture", model: "selected" },
  judge: { provider: "fixture", model: "selected" },
};
function target(): Extract<ScheduleTarget, { type: "workflow" }> {
  return {
    type: "workflow",
    source: {
      scope: { hostId: "host", projectId: "project" },
      kind: "graph",
      id: "saved",
      location: "repository",
      storeKey: "origin",
    },
    workspaceId: "workspace",
    seats,
    limits: DEFAULT_WORKFLOW_LIMITS,
    inputs: { data: "current" },
    approval: {
      policyFingerprint: "a".repeat(64),
      allowTemplateCode: false,
      allowQueryEffects: false,
    },
  };
}
function graph(): Extract<WorkflowLaunch, { kind: "graph" }> {
  return {
    kind: "graph",
    graph: OrchestrationGraphSchema.parse({
      id: "saved",
      name: "Saved",
      nodes: [
        {
          id: "agent",
          kind: "agent",
          title: "Worker",
          prompt: "Old prompt",
          access: "read",
          tools: ["knowledge"],
        },
      ],
      edges: [],
    }),
    seats,
    limits: DEFAULT_WORKFLOW_LIMITS,
    inputs: { data: "current" },
  };
}
test("saved payload/labels/layout may update without silently changing approved authority", () => {
  const before = graph();
  const after = {
    ...before,
    graph: {
      ...before.graph,
      name: "Renamed",
      description: "Updated",
      updatedAt: "new",
      nodes: before.graph.nodes.map((node) => ({
        ...node,
        title: "Renamed worker",
        prompt: "New task",
        position: { x: 10, y: 20 },
      })),
    },
  };
  expect(workflowScheduleAuthority(target(), after)).toBe(
    workflowScheduleAuthority(target(), before),
  );
});
test.each(["access", "tools", "model", "futureAuthority"] as const)(
  "changed node %s requires another review",
  (field) => {
    const before = graph();
    const after = {
      ...before,
      graph: {
        ...before.graph,
        nodes: before.graph.nodes.map((node) => ({
          ...node,
          [field]: field === "tools" ? ["browser"] : "changed",
        })),
      },
    };
    expect(workflowScheduleAuthority(target(), after)).not.toBe(
      workflowScheduleAuthority(target(), before),
    );
  },
);
test("topology, seats, limits and owning workspace cannot drift under the same approval", () => {
  const before = graph();
  const initial = target();
  const baseline = workflowScheduleAuthority(initial, before);
  expect(workflowScheduleAuthority({ ...initial, workspaceId: "other" }, before)).not.toBe(
    baseline,
  );
  expect(
    workflowScheduleAuthority(
      { ...initial, seats: { ...seats, worker: { provider: "other", model: "changed" } } },
      before,
    ),
  ).not.toBe(baseline);
  expect(
    workflowScheduleAuthority({ ...initial, limits: { ...initial.limits, maxAgents: 1 } }, before),
  ).not.toBe(baseline);
  expect(
    workflowScheduleAuthority(initial, {
      ...before,
      graph: {
        ...before.graph,
        nodes: [...before.graph.nodes, { id: "gate", kind: "human-gate", title: "Review" }],
      },
    }),
  ).not.toBe(baseline);
});
test("AI prompt edits retain policy while saved autopilot changes require review", () => {
  const definition = AiWorkflowDefinition.parse({
    format: "otto.workflow.ai",
    formatVersion: 1,
    id: "saved",
    title: "AI",
    prompt: "Old task",
    seats,
    limits: DEFAULT_WORKFLOW_LIMITS,
    autopilot: false,
    createdAt: "now",
    updatedAt: "now",
  });
  const launch: WorkflowLaunch = { kind: "ai", definition };
  const source = { ...target(), source: { ...target().source, kind: "ai" as const } };
  const baseline = workflowScheduleAuthority(source, launch);
  expect(
    workflowScheduleAuthority(source, {
      ...launch,
      definition: { ...definition, prompt: "New task", title: "Renamed" },
    }),
  ).toBe(baseline);
  expect(
    workflowScheduleAuthority(source, {
      ...launch,
      definition: { ...definition, autopilot: true },
    }),
  ).not.toBe(baseline);
});

test.each([false, true])(
  "executable-template policy %s binds revisions only when code is approved",
  (allowCode) => {
    const initial = target();
    initial.approval.allowTemplateCode = allowCode;
    const snapshot = {
      ref: { ...initial.source, kind: "template" as const },
      revision: "first",
      template: { id: "template", name: "Template", content: "Prompt" },
    };
    const before = { ...graph(), allowTemplateCode: allowCode, templateSnapshots: [snapshot] };
    const after = {
      ...before,
      templateSnapshots: [
        {
          ...snapshot,
          revision: "changed",
          template: { ...snapshot.template, content: "Updated prompt" },
        },
      ],
    };
    expect(
      workflowScheduleAuthority(initial, before) !== workflowScheduleAuthority(initial, after),
    ).toBe(allowCode);
  },
);
