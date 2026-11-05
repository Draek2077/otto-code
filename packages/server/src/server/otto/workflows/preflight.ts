import { randomUUID } from "node:crypto";
import {
  WorkflowLaunch,
  WorkflowSeats,
  type WorkflowScope,
  type RunPlan,
  type WorkflowScheduleSource,
  runPhaseEditsWorkspace,
  describeRunPlanStart,
} from "@getpaseo/plugin/otto/workflows";
import type { WorkflowRuntimePorts, WorkflowWorkspace } from "./runtime-ports.js";
import { validateGraphForExecution } from "./graph-engine.js";
import { buildRunFromPlan } from "./workflow-engine.js";
import { WorkflowError, workflowDigest } from "./files.js";
import { canonicalJson } from "./graph-identity.js";
import { workflowQueryProblems } from "./node-queries.js";

export interface WorkflowReview {
  token: string;
  scope: WorkflowScope;
  workspace: WorkflowWorkspace;
  launch: WorkflowLaunch;
  operationId: string;
  fingerprint: string;
  expiresAt: number;
  scheduleSource?: WorkflowScheduleSource;
}
export function seatsFor(launch: WorkflowLaunch) {
  return launch.kind === "ai" ? (launch.seats ?? launch.definition.seats) : launch.seats;
}
export function limitsFor(launch: WorkflowLaunch) {
  return launch.kind === "ai" ? (launch.limits ?? launch.definition.limits) : launch.limits;
}

/** Review binds content, exact seats, project/workspace and operation; it never starts a native provider. */
export async function reviewWorkflow(
  ports: WorkflowRuntimePorts,
  scope: WorkflowScope,
  workspaceId: string,
  raw: WorkflowLaunch,
  operationId: string,
): Promise<WorkflowReview> {
  if (Buffer.byteLength(JSON.stringify(raw)) > 512000)
    throw new WorkflowError(
      "invalid",
      "Reviewed launch (including captured templates) exceeds 500 KB. Use file references for larger material.",
    );
  const launch = WorkflowLaunch.parse(raw);
  if (launch.kind === "graph")
    launch.inputs = {
      ...Object.fromEntries(
        (launch.graph.inputs ?? [])
          .filter((field) => field.defaultValue !== undefined)
          .map((field) => [field.key, field.defaultValue!]),
      ),
      ...launch.inputs,
    };
  const workspace = await ports.workspace(scope, workspaceId);
  if (workspace.projectId !== scope.projectId || workspace.workspaceId !== workspaceId)
    throw new WorkflowError("invalid", "Workflow workspace does not belong to this project.");
  const problems = launch.kind === "graph" ? graphProblems(launch) : [];
  const seats = WorkflowSeats.parse(seatsFor(launch));
  if (launch.kind === "ai")
    problems.push(...((await ports.validateTools?.(seats.conductor, ["start_workflow"])) ?? []));
  problems.push(...(await ports.validateSeat(seats.conductor, workspace, "write")));
  for (const seat of [seats.worker, seats.judge])
    problems.push(...(await ports.validateSeat(seat, workspace, "write")));
  if (launch.kind === "graph")
    problems.push(...(await graphSeatProblems(ports, launch, seats, workspace)));
  if (problems.length) throw new WorkflowError("unsupported", problems.join(" "));
  return {
    token: randomUUID(),
    scope,
    workspace,
    launch: structuredClone(launch),
    operationId,
    fingerprint: workflowDigest(
      JSON.stringify(canonicalJson([scope, workspace, launch, operationId])),
    ),
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
}
async function graphSeatProblems(
  ports: WorkflowRuntimePorts,
  launch: Extract<WorkflowLaunch, { kind: "graph" }>,
  seats: WorkflowSeats,
  workspace: WorkflowWorkspace,
): Promise<string[]> {
  const problems: string[] = [];
  for (const node of launch.graph.nodes) {
    if (node.kind !== "agent") continue;
    const seat = node.model ? parseGraphSeat(node.model) : seats.worker;
    problems.push(...(await ports.validateSeat(seat, workspace, graphAccess(node.access))));
    if (node.autonomous)
      problems.push(
        ...((await ports.validateTools?.(seat, ["delegate_workflow_task", "create_agent"])) ?? []),
      );
    if (node.loop?.until)
      problems.push(...(await ports.validateSeat(seats.judge, workspace, "read")));
  }
  return problems;
}
function graphProblems(launch: Extract<WorkflowLaunch, { kind: "graph" }>): string[] {
  if (launch.graph.nodes.length > 64 || (launch.graph.edges?.length ?? 0) > 128)
    return ["A Graph supports at most 64 nodes and 128 edges."];
  const expressions = [
    ...launch.graph.nodes.map((n) => n.check?.expression ?? ""),
    ...(launch.graph.edges ?? []).map((e) => e.when?.expression ?? ""),
  ];
  if (expressions.some((e) => e.length > 4096) || expressions.join("").length > 64000)
    return ["Graph expressions exceed the review budget."];
  const problems = [...validateGraphForExecution(launch.graph), ...workflowQueryProblems(launch)];
  const supplied = launch.inputs;
  for (const field of launch.graph.inputs ?? [])
    if (field.required !== false && !supplied[field.key]?.trim())
      problems.push(`Provide Graph input ${field.key}.`);
  if (launch.graph.nodes.filter((n) => n.kind === "agent").length + 1 > launch.limits.maxAgents)
    problems.push("Graph exceeds the selected agent limit.");
  return problems;
}
export function graphAccess(access: string | undefined): "read" | "none" | "write" {
  if (access === undefined || access === "write") return "write";
  if (access === "read" || access === "none") return access;
  throw new WorkflowError("unsupported", "This Graph declares an unknown workspace access policy.");
}
export function parseGraphSeat(model: string) {
  const slash = model.indexOf("/");
  return slash < 0
    ? { provider: model }
    : { provider: model.slice(0, slash), model: model.slice(slash + 1) };
}
export async function validatePlan(
  ports: WorkflowRuntimePorts,
  review: { launch: WorkflowLaunch; workspace: WorkflowWorkspace },
  plan: RunPlan,
) {
  if (Buffer.byteLength(JSON.stringify(plan)) > 128000)
    throw new WorkflowError("invalid", "Workflow plan exceeds its review budget.");
  if (plan.phases.length > 64)
    throw new WorkflowError(
      "invalid",
      "An AI Workflow supports at most 64 phases, including gates.",
    );
  buildRunFromPlan({ plan, id: "review", now: ports.now() });
  if (describeRunPlanStart(plan).plannedAgentCount + 1 > limitsFor(review.launch).maxAgents)
    throw new WorkflowError("invalid", "The declared plan exceeds the reviewed agent limit.");
  const seats = seatsFor(review.launch);
  const problems: string[] = [];
  for (const phase of plan.phases) {
    if (phase.type === "gate") continue;
    problems.push(
      ...(await ports.validateSeat(
        phase.type === "verify" ? seats.judge : seats.worker,
        review.workspace,
        planPhaseAccess(phase),
      )),
    );
    if (phase.judge)
      problems.push(...(await ports.validateSeat(seats.judge, review.workspace, "read")));
  }
  if (problems.length) throw new WorkflowError("unsupported", problems.join(" "));
}
export function planPhaseAccess(phase: {
  type: string;
  role?: string;
  fanOut?: number;
  keepBest?: number;
}): "read" | "write" {
  if (runPhaseEditsWorkspace(phase)) return "write";
  return (phase.fanOut ?? 1) > 1 || phase.keepBest !== undefined ? "read" : "write";
}
