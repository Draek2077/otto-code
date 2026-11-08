import { stat } from "node:fs/promises";
import type { AgentStorage } from "../../agent/agent-storage.js";
import type { ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import type { ScheduleStorePorts, ProjectScheduleScope } from "./stores.js";
import type { ScheduleTarget, StoredSchedule } from "./types.js";
import type { z } from "zod";
import type { ArtifactSelection } from "@getpaseo/plugin/otto/artifacts";
import {
  validateAgentConfigurationAgainstProvider,
  type AgentConfigurationValidationInput,
} from "../../agent/agent-configuration-validator.js";
import { isPathInsideRoot } from "../../../utils/path.js";
import { ScheduleError } from "./files.js";

export interface ScheduleNativePolicyPorts extends ScheduleStorePorts {
  storage: Pick<AgentStorage, "get">;
  workspaces: Pick<WorkspaceRegistry, "get" | "list">;
  providers: Pick<ProviderSnapshotManager, "hasProvider" | "getProvider">;
}
/** Uses canonical project/workspace and provider owners. No credential store,
 * ad-hoc provider process, inferred repository root, or second model catalog. */
export class ScheduleNativePolicy {
  constructor(readonly ports: ScheduleNativePolicyPorts) {}
  private async provider(input: AgentConfigurationValidationInput, cwd: string) {
    if (!this.ports.providers.hasProvider(input.provider))
      throw new ScheduleError("invalid", "Select a provider configured on this Schedule's host.");
    const provider = await this.ports.providers.getProvider({
      provider: input.provider,
      cwd,
      wait: true,
    });
    if (!provider.enabled)
      throw new ScheduleError(
        "invalid",
        "Enable the selected provider before resuming this Schedule.",
      );
    if (provider.status !== "ready")
      throw new ScheduleError(
        "unavailable",
        "The selected provider is unavailable. The Schedule will wait until its next scheduled time.",
      );
    if (validateAgentConfigurationAgainstProvider({ input, provider }).length)
      throw new ScheduleError(
        "invalid",
        "Review this Schedule's model, permission mode and effort against the current provider catalog.",
      );
  }
  private async project(scope: ProjectScheduleScope | null) {
    if (!scope) return null;
    if (scope.hostId !== this.ports.hostId)
      throw new ScheduleError("invalid", "Select the owning Schedule host.");
    const project = await this.ports.metadata.read(scope.projectId);
    if (project.record.archivedAt)
      throw new ScheduleError(
        "invalid",
        "Restore this Schedule's owning project before running it.",
      );
    return project;
  }
  private async directory(
    cwd: string,
    project: Awaited<ReturnType<ScheduleNativePolicy["project"]>>,
    workspaceId?: string,
  ) {
    if (!project) return;
    if (workspaceId) {
      const workspace = await this.ports.workspaces.get(workspaceId);
      if (!workspace || workspace.archivedAt || workspace.projectId !== project.projectId)
        throw new ScheduleError(
          "invalid",
          "Select an active chat/workspace in this Schedule's project.",
        );
      if (!isPathInsideRoot(workspace.cwd, cwd))
        throw new ScheduleError(
          "invalid",
          "The target chat directory no longer belongs to its recorded workspace.",
        );
      return;
    }
    const roots = [
      project.rootPath,
      ...(await this.ports.workspaces.list())
        .filter((item) => item.projectId === project.projectId && !item.archivedAt)
        .map((item) => item.cwd),
    ];
    if (!roots.some((root) => isPathInsideRoot(root, cwd)))
      throw new ScheduleError(
        "invalid",
        "Select a working directory in this Schedule's canonical project or one of its active workspaces.",
      );
  }
  async validate(
    target: Extract<ScheduleTarget, { type: "agent" | "new-agent" }>,
    scope: ProjectScheduleScope | null,
  ) {
    const project = await this.project(scope);
    if (target.type === "agent") {
      const record = await this.ports.storage.get(target.agentId);
      if (!record || record.archivedAt)
        throw new ScheduleError(
          "invalid",
          "Restore or select an active target chat for this Schedule.",
        );
      await this.directory(record.cwd, project, record.workspaceId);
      await this.provider(
        {
          provider: record.provider,
          model: record.config?.model ?? undefined,
          modeId: record.config?.modeId ?? undefined,
          thinkingOptionId: record.config?.thinkingOptionId ?? undefined,
        },
        record.cwd,
      );
      return record.title ?? record.id;
    }
    await this.directory(target.config.cwd, project);
    try {
      if (!(await stat(target.config.cwd)).isDirectory()) throw new Error("Not a directory");
    } catch (error) {
      throw new ScheduleError(
        "invalid",
        "Restore the selected working directory on the owning Schedule host.",
        { cause: error },
      );
    }
    await this.provider(target.config, target.config.cwd);
    return target.config.title ?? "New agent";
  }
  async validateStored(schedule: StoredSchedule) {
    const target = schedule.target;
    if (target.type !== "agent" && target.type !== "new-agent")
      throw new ScheduleError("unsupported", "Native Schedule policy received an extended target.");
    const scope = schedule.otto?.scope;
    if (scope && scope.hostId !== this.ports.hostId)
      throw new ScheduleError("invalid", "Schedule belongs to another host.");
    await this.validate(
      target,
      scope?.projectId ? { hostId: scope.hostId, projectId: scope.projectId } : null,
    );
  }
  async validateSelection(
    selection: z.infer<typeof ArtifactSelection>,
    scope: ProjectScheduleScope,
  ) {
    const project = await this.project(scope);
    if (!project)
      throw new ScheduleError("invalid", "Select the owning project for this model operation.");
    await this.provider(selection, project.rootPath);
  }
}
