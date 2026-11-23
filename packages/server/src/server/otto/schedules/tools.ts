import { z } from "zod";
import * as rpc from "@getpaseo/plugin/otto/schedules";
import type { ScheduleDaemonService } from "./service.js";
import { ScheduleError } from "./files.js";
import type { RetainedToolPolicy } from "../retained-tool-policy.js";
import type { WorkflowToolPorts } from "../workflows/tools.js";
import type { PaseoToolDefinition, PaseoToolResult } from "../../agent/tools/types.js";

interface Ports {
  host?: Pick<ScheduleDaemonService, "invoke">;
  policy?: RetainedToolPolicy;
  owner?: Pick<WorkflowToolPorts, "caller" | "scope">;
}
const discovery = z.object({
  workspaceId: z.string().min(1).max(512).optional(),
  operation: z.string().min(1).max(512).optional(),
  readOnly: z.boolean().optional(),
});
const request = z.object({
  workspaceId: z.string().min(1).max(512).optional(),
  method: z.string().min(1).max(512),
  input: z.unknown(),
  userApproved: z.boolean().optional(),
});
const response = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: rpc.ScheduleFailure }),
]);
const hostSettings = new Set([rpc.readScheduleDefaults.name, rpc.saveScheduleDefaults.name]);
function result(value: unknown, isError = false): PaseoToolResult {
  return { content: [], structuredContent: value, ...(isError ? { isError } : {}) };
}

/** Two small progressive-discovery tools, not twenty schemas injected into every
 * provider turn. Authority stays with the existing caller/workspace registry. */
export function scheduleCatalogTools({ host, policy, owner }: Ports): PaseoToolDefinition[] {
  if (!host || !policy || !owner) return [];
  const select = async (name: string, requested?: string) => {
    const caller = owner.caller();
    if (!(await policy(name, caller.provider)))
      throw new ScheduleError("unavailable", "This host/provider has disabled Schedule tools.");
    if (caller.agentId && !caller.workspaceId)
      throw new ScheduleError("unavailable", "The calling chat no longer has an owning workspace.");
    if (requested && caller.workspaceId && requested !== caller.workspaceId)
      throw new ScheduleError(
        "invalid",
        "Schedule tools are bound to the calling chat's workspace.",
      );
    const workspaceId = caller.workspaceId ?? requested;
    if (!workspaceId)
      throw new ScheduleError("invalid", "Supply an active workspace outside a chat.");
    return owner.scope(workspaceId);
  };
  const guard = async (operation: () => Promise<unknown>) => {
    try {
      const value = await operation();
      if (Buffer.byteLength(JSON.stringify(value)) > 400000)
        throw new ScheduleError(
          "unavailable",
          "This response exceeds the tool budget. Read a smaller history page or retained run part.",
        );
      const failed = response.safeParse(value);
      return result(value, failed.success && !failed.data.ok);
    } catch (error) {
      return result(
        {
          error:
            error instanceof ScheduleError
              ? error.message
              : "The Schedule operation could not be acknowledged. Inspect its owning origin or operation receipt before another write. No automatic retry or alternate target was selected.",
        },
        true,
      );
    }
  };
  return [
    {
      name: "schedule_catalog",
      annotations: { readOnlyHint: true },
      description:
        "Discover project-owned Schedule operations, then request the exact schema for ONE operation. Uses this chat's canonical workspace/project; outside a chat supply workspaceId. No saved prompts or histories are injected. Existing agent, saved AI/Graph Workflow and data-only Artifact targets share one scheduler.",
      inputSchema: discovery,
      handler: (value) =>
        guard(async () => {
          const input = discovery.parse(value),
            scope = await select("schedule_catalog", input.workspaceId);
          const operations = rpc.scheduleOperations.filter(
            (operation) =>
              (!input.operation || operation.name === input.operation) &&
              (!input.readOnly || !rpc.scheduleOperationWrites(operation.name)),
          );
          if (input.operation && !operations.length)
            throw new ScheduleError("invalid", "Select an available Schedule operation.");
          return {
            scope,
            operations: operations.map((operation) =>
              rpc.describeScheduleOperation(operation, !!input.operation),
            ),
          };
        }),
    },
    {
      name: "schedule_operation",
      annotations: { readOnlyHint: false },
      description:
        "Call ONE discovered Schedule operation using its exact origin and revision. Obtain user approval for writes and set userApproved:true only for that exact action. Never retry an unconfirmed write: inspect creation intent or transfer receipt. Workflow human gates still wait for approval; failures wait until the next scheduled time. Artifact updates preserve HTML design. No recursive scheduling from Workflow-owned members.",
      inputSchema: request,
      handler: (value) =>
        guard(async () => {
          const input = request.parse(value),
            scope = await select("schedule_operation", input.workspaceId);
          const operation = rpc.scheduleOperations.find(
            (candidate) => candidate.name === input.method,
          );
          if (!operation)
            throw new ScheduleError("invalid", "Discover an available Schedule operation first.");
          if (rpc.scheduleOperationWrites(operation.name) && input.userApproved !== true)
            throw new ScheduleError(
              "invalid",
              "Obtain explicit approval for this exact Schedule write first.",
            );
          const data = operation.input.parse(input.input),
            selected = rpc.scheduleOperationScope(operation.name, data);
          if (
            selected.hostId !== scope.hostId ||
            (!hostSettings.has(operation.name) && selected.projectId !== scope.projectId)
          )
            throw new ScheduleError(
              "invalid",
              "This Schedule operation belongs to another project or host.",
            );
          if (
            operation.name === rpc.listSchedules.name &&
            rpc.listSchedules.input.parse(data).includeLegacy
          )
            throw new ScheduleError(
              "invalid",
              "Inspect unassigned legacy records through the app or CLI, then explicitly transfer them into this project.",
            );
          const outcome = response.parse(
            operation.output.parse(await host.invoke(operation.name, data)),
          );
          if (outcome.ok) rpc.assertScheduleAcknowledgement(operation.name, data, outcome.value);
          return outcome;
        }),
    },
  ];
}
export function registerScheduleTools(
  tools: Map<string, PaseoToolDefinition>,
  ports: Ports,
  enabled: (name: string) => boolean,
) {
  for (const tool of scheduleCatalogTools(ports))
    if (enabled(tool.name)) tools.set(tool.name, tool);
}
