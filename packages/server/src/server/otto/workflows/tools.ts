import { z } from "zod";
import * as rpc from "@getpaseo/plugin/otto/workflows";
import type {
  PaseoToolDefinition,
  PaseoToolResult,
  PaseoToolExecutionContext,
} from "../../agent/tools/types.js";
import type { RetainedToolPolicy } from "../retained-tool-policy.js";
import type { WorkflowDaemonService } from "./service.js";
import type { WorkflowAgentBinding } from "./runtime-ports.js";
import { WorkflowError } from "./files.js";
import { compileOutputToolInputShape, validateNodeOutput, NodeOutputStore } from "./node-output.js";
import { executeWorkflowQuery, queryToolName } from "./node-queries.js";
import { workflowToolGroupAllowed, workflowDelegationAllowed } from "./tool-groups.js";

const operations = [
  rpc.workflowInspectTransfer,
  rpc.workflowReconcileTransfer,
  rpc.workflowRecoverTransferLock,
  rpc.workflowPreviewTemplate,
  rpc.workflowList,
  rpc.workflowRead,
  rpc.workflowReadOutput,
  rpc.workflowSave,
  rpc.workflowDelete,
  rpc.workflowValidate,
  rpc.workflowReviewStart,
  rpc.workflowStart,
  rpc.workflowControl,
  rpc.workflowReadStorage,
  rpc.workflowSetStorage,
  rpc.workflowTransfer,
  rpc.workflowInspectRecovery,
  rpc.workflowRecover,
  rpc.workflowRecoverLock,
  rpc.workflowExport,
  rpc.workflowImportReview,
  rpc.workflowImportCommit,
  rpc.workflowImportInspect,
  rpc.workflowImportReconcile,
] as const;
const readMethods = new Set([
  rpc.workflowInspectTransfer.name,
  rpc.workflowList.name,
  rpc.workflowRead.name,
  rpc.workflowReadOutput.name,
  rpc.workflowValidate.name,
  rpc.workflowReadStorage.name,
  rpc.workflowInspectRecovery.name,
  rpc.workflowExport.name,
  rpc.workflowImportInspect.name,
]);
const localReads = new Set([
  "list_project_knowledge",
  "read_project_knowledge",
  "read_project_knowledge_root",
  "read_project_knowledge_policy",
  "read_project_knowledge_review_signals",
  "lint_project_knowledge_links",
  "inspect_project_knowledge_format",
  "inspect_project_knowledge_storage",
  "inspect_project_knowledge_lock",
  "list_artifacts",
  "read_artifact",
  "get_workflow_status",
  "submit_output",
]);
const noWorkspaceTools = new Set([
  "get_workflow_status",
  "submit_output",
  "delegate_workflow_task",
]);
const privateDefinitions = new WeakSet<PaseoToolDefinition>();
const unmanaged = new Set([
  "create_agent",
  "send_agent_prompt",
  "cancel_agent",
  "archive_agent",
  "kill_agent",
  "update_agent",
  "set_agent_mode",
  "respond_to_permission",
  "create_workspace",
  "archive_workspace",
  "rename_workspace",
  "create_schedule",
  "schedule_operation", // OTTO(schedules): a reserved Workflow member cannot create nested scheduler authority.
  "create_heartbeat",
  "delete_heartbeat",
  "pause_schedule",
  "resume_schedule",
  "delete_schedule",
  "update_schedule",
  "run_schedule_once",
  "create_terminal",
  "send_terminal_keys",
  "kill_terminal",
  "start_workspace_script",
  "stop_workspace_script",
]);
function result(value: unknown, isError = false): PaseoToolResult {
  return { content: [], structuredContent: value, ...(isError ? { isError } : {}) };
}
function status(entry: rpc.WorkflowEntry) {
  if (entry.document.kind !== "run") throw new WorkflowError("invalid", "Not a Workflow run.");
  const run = entry.document.value;
  return {
    ref: entry.ref,
    revision: entry.revision,
    title: run.title.slice(0, 240),
    status: run.status,
    error: run.error,
    phases: run.phases.map((p) => ({
      id: p.id.slice(0, 128),
      title: p.title.slice(0, 160),
      status: p.status,
      notes: p.notes?.slice(0, 240),
      agentIds: p.candidates?.map((c) => c.agentId),
    })),
    instruction:
      run.status === "planning"
        ? "Clarify in this chat, then declare one bounded plan with start_workflow."
        : undefined,
  };
}
export interface WorkflowToolPorts {
  service: WorkflowDaemonService;
  outputs: NodeOutputStore;
  policy: RetainedToolPolicy;
  caller(): { agentId?: string; provider?: string; workspaceId?: string };
  /** Uses the canonical workspace registry, including explicit selection outside an agent. */
  scope(workspaceId: string): Promise<rpc.WorkflowScope>;
}

/** Private tools derive authority from the host reservation, never caller-supplied labels/run ids. */
export function createWorkflowTools(ports: WorkflowToolPorts): PaseoToolDefinition[] {
  const initial = ports.caller();
  const reserved = initial.agentId ? ports.service.host.reservation(initial.agentId) : null;
  const live = () => {
    const caller = ports.caller();
    const binding = caller.agentId ? ports.service.host.binding(caller.agentId) : null;
    if (!binding || binding.request.agentId !== initial.agentId)
      throw new WorkflowError("unavailable", "Workflow execution authority has ended.");
    return binding;
  };
  const tool = <T extends z.ZodType>(
    name: string,
    description: string,
    inputSchema: T,
    run: (input: z.infer<T>, context: PaseoToolExecutionContext) => Promise<unknown>,
    requiresPolicy = true,
  ): PaseoToolDefinition => ({
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: localReads.has(name) },
    async handler(input, context) {
      try {
        const caller = ports.caller();
        if (requiresPolicy && !(await ports.policy(name, caller.provider)))
          throw new WorkflowError(
            "unavailable",
            "This host/provider has disabled the Workflow tool group.",
          );
        if (
          name === "delegate_workflow_task" &&
          !(await ports.policy("create_agent", caller.provider))
        )
          throw new WorkflowError("unavailable", "This provider has disabled agent creation.");
        return result(await run(inputSchema.parse(input), context));
      } catch (error) {
        return result(
          {
            error: workflowToolError(error),
          },
          true,
        );
      }
    },
  });
  if (reserved) {
    const tools = [
      tool(
        "get_workflow_status",
        "Read this owned Workflow's compact, actual phase state. No transcript duplication or status inference.",
        z.object({}),
        async () => status(await ports.service.library.read(live().ref)),
      ),
    ];
    if (reserved.role === "conductor")
      tools.push(
        tool(
          "start_workflow",
          "Declare the AI Workflow plan once. The user reviews it before workers start unless autopilot was explicitly approved. After success END THIS TURN: workers wait for the planning turn to settle. Do not wait/poll or launch independent agents.",
          rpc.RunPlanSchema,
          async (plan) => {
            const binding = live();
            if (binding.role !== "conductor")
              throw new WorkflowError("invalid", "Only the conductor can declare this plan.");
            return {
              ...status(
                await ports.service.host.declarePlan(binding.ref, plan, binding.request.agentId),
              ),
              instruction:
                "Plan saved. End this turn now. The Workflow host owns execution and confirmation; do not poll or start separate agents.",
            };
          },
        ),
      );
    if (reserved.request.outputFields?.length)
      tools.push(
        tool(
          "submit_output",
          "Submit this node's declared structured deliverable. Correct validation errors before ending your turn.",
          z.object(compileOutputToolInputShape(reserved.request.outputFields)).passthrough(),
          async (input) => {
            const binding = live();
            if (Buffer.byteLength(JSON.stringify(input)) > 64000)
              throw new WorkflowError("invalid", "Structured output exceeds 64 KB.");
            const checked = validateNodeOutput(binding.request.outputFields ?? [], input);
            if (!checked.ok) throw new WorkflowError("invalid", checked.message);
            ports.outputs.record(binding.request.agentId, checked.value);
            return { accepted: true };
          },
          false,
        ),
      );
    if (
      reserved.role === "worker" &&
      reserved.request.autonomous &&
      workflowDelegationAllowed(reserved.request.toolGroups)
    )
      tools.push(
        tool(
          "delegate_workflow_task",
          "Delegate one bounded read-only or no-workspace task to the same captured model. Wait for its result here. All descendants share this run's agent/time/concurrency limits; shared-checkout write delegation is unavailable until attempt isolation is introduced.",
          z.object({ task: z.string().min(1).max(32000), access: z.enum(["read", "none"]) }),
          async (input, context) =>
            ports.service.host.delegate(live().request.agentId, input, context.signal),
        ),
      );
    for (const query of reserved.request.queryTools ?? [])
      tools.push({
        name: queryToolName(query),
        description: query.description,
        inputSchema: z.object(compileOutputToolInputShape(query.parameters ?? [])).passthrough(),
        annotations: { readOnlyHint: query.kind !== "command" },
        async handler(input, context) {
          try {
            const binding = live();
            const signal = ports.service.host.memberSignal(binding.request.agentId);
            const combined = context.signal ? AbortSignal.any([signal, context.signal]) : signal;
            const text = await executeWorkflowQuery(
              query,
              input,
              binding.request.workspace.cwd,
              combined,
            );
            return { content: [{ type: "text", text }] };
          } catch (error) {
            return result({ error: workflowToolError(error) }, true);
          }
        },
      });
    for (const definition of tools) privateDefinitions.add(definition);
    return tools;
  }
  const select = async (workspaceId?: string) => {
    const caller = ports.caller();
    if (caller.workspaceId && workspaceId && caller.workspaceId !== workspaceId)
      throw new WorkflowError("invalid", "Workflows are bound to the calling chat's workspace.");
    const id = caller.workspaceId ?? workspaceId;
    if (!id) throw new WorkflowError("invalid", "Select a workspace.");
    return ports.scope(id);
  };
  return [
    tool(
      "workflow_catalog",
      "Discover Workflow operation names, then request the exact input schema for ONE operation. No saved graph/prompt contents are loaded. AI runs start in Planning; Graph runs require review of exact content and limits.",
      z.object({
        workspaceId: z.string().optional(),
        readOnly: z.boolean().optional(),
        operation: z.string().optional(),
      }),
      async (input) => {
        await select(input.workspaceId);
        return {
          operations: operations
            .filter(
              (op) =>
                (!input.readOnly || readMethods.has(op.name)) &&
                (!input.operation || input.operation === op.name),
            )
            .map((op) =>
              input.operation
                ? { name: op.name, input: z.toJSONSchema(op.input) }
                : { name: op.name },
            ),
        };
      },
    ),
    tool(
      "workflow_operation",
      "Call a discovered Workflow operation. Use the exact returned schema and originating revisions. Never retry an unknown write. Review/start are separate; storage transfers require explicit confirmation. No nested Workflow launches from owned run members.",
      z.object({ workspaceId: z.string().optional(), method: z.string(), input: z.unknown() }),
      async (input) => {
        const scope = await select(input.workspaceId);
        const op = operations.find((candidate) => candidate.name === input.method);
        if (!op)
          throw new WorkflowError("invalid", "Discover an available Workflow operation first.");
        const data = op.input.parse(input.input);
        // All allowed envelopes bind through either scope, ref.scope or source.scope.
        let selectedValue: unknown = null;
        if ("scope" in data) selectedValue = data.scope;
        else if ("ref" in data) selectedValue = data.ref?.scope;
        else if ("source" in data) selectedValue = data.source.scope;
        else selectedValue = data;
        const selected = rpc.WorkflowScope.parse(selectedValue);
        if (selected.hostId !== scope.hostId || selected.projectId !== scope.projectId)
          throw new WorkflowError("invalid", "Workflow operation belongs to another project/host.");
        return ports.service.invoke(op.name, data);
      },
    ),
  ];
}
function workflowToolError(error: unknown): string {
  if (error instanceof WorkflowError) return error.message;
  if (error instanceof z.ZodError)
    return error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")
      .slice(0, 2000);
  return "Workflow operation was not acknowledged. Inspect its owning origin before another write.";
}

export function registerWorkflowTools(
  tools: Map<string, PaseoToolDefinition>,
  ports: WorkflowToolPorts | undefined,
  enabled: (name: string) => boolean,
): void {
  if (!ports) return;
  for (const tool of createWorkflowTools(ports))
    if (tool.name === "submit_output" || enabled(tool.name)) tools.set(tool.name, tool);
  constrainWorkflowCatalog(tools, ports);
}

/** Apply only to reserved members. Vendor readOnlyHint is not authorization for external tools. */
export function constrainWorkflowCatalog(
  tools: Map<string, PaseoToolDefinition>,
  ports: WorkflowToolPorts,
): void {
  const caller = ports.caller();
  const reserved = caller.agentId ? ports.service.host.reservation(caller.agentId) : null;
  if (!reserved) return;
  for (const [name, definition] of tools) {
    if (
      unmanaged.has(name) ||
      name === "workflow_catalog" ||
      name === "workflow_operation" ||
      (!privateDefinitions.has(definition) &&
        !workflowToolGroupAllowed(name, reserved.request.toolGroups)) ||
      (!privateDefinitions.has(definition) &&
        reserved.request.access === "read" &&
        !localReads.has(name) &&
        name !== "delegate_workflow_task") ||
      (!privateDefinitions.has(definition) &&
        reserved.request.access === "none" &&
        !noWorkspaceTools.has(name))
    ) {
      tools.delete(name);
      continue;
    }
    tools.set(name, {
      ...definition,
      async handler(input, context) {
        const binding = caller.agentId ? ports.service.host.binding(caller.agentId) : null;
        if (!binding) return result({ error: "Workflow execution authority has ended." }, true);
        const scoped = scopeToolInput(input, binding);
        return definition.handler(scoped, context);
      },
    });
  }
}
function scopeToolInput(input: unknown, binding: WorkflowAgentBinding): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  return { ...input, workspaceId: binding.request.workspace.workspaceId };
}
