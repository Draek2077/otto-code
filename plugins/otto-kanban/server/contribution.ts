import type { PluginServerContribution } from "@getpaseo/plugin/server";
import {
  failure,
  ProjectBindingSchema,
  type ProjectBinding,
  type ProjectConfiguration,
  type Result,
} from "../shared/model.js";
import {
  getBoard,
  getCapabilities,
  getProjectConfiguration,
  setProjectTarget,
} from "../shared/rpc.js";
import { createGitHubReader } from "./github-reader.js";
import type { GitHubReadPort, ProjectBoardPort } from "./ports.js";
import { readProjectTarget } from "./project-config.js";
import { createBoardService } from "./read-service.js";

interface KanbanPorts {
  projects: ProjectBoardPort;
  github: GitHubReadPort;
}

async function configuration(
  projects: ProjectBoardPort,
  binding: ProjectBinding,
): Promise<Result<ProjectConfiguration>> {
  if (!ProjectBindingSchema.safeParse(binding).success || binding.hostId !== projects.hostId) {
    return failure("wrong_host", "Select this project's owning host.");
  }
  try {
    const snapshot = await projects.read(binding);
    if (!snapshot.ok) return snapshot;
    if (
      snapshot.value.binding.hostId !== binding.hostId ||
      snapshot.value.binding.projectId !== binding.projectId
    ) {
      return failure("wrong_host", "The host returned settings for a different project.");
    }
    const target = readProjectTarget(snapshot.value.record);
    if (!target.ok) return target;
    return {
      ok: true,
      value: { binding, settingsRevision: snapshot.value.revision, target: target.value },
    };
  } catch {
    return failure("unavailable", "The owning host could not read Project Settings.");
  }
}

// Parent composition supplies daemon-owned ports after their shared contracts
// are reviewed. This is not a plugin entry and has no registration side effects.
export function createKanbanHandlers(ports: KanbanPorts) {
  if (ports.projects.hostId !== ports.github.hostId) {
    throw new Error("Kanban project and forge ports must belong to the same host.");
  }
  const service = createBoardService({
    projects: ports.projects,
    github: createGitHubReader(ports.github),
  });
  return {
    capabilities({ hostId }: { hostId: string }) {
      if (hostId !== ports.projects.hostId)
        return failure("wrong_host", "Select this project's owning host.");
      return {
        ok: true as const,
        value: {
          hostId,
          contractVersion: 1 as const,
          read: true,
          configure: true,
          providers: [
            { id: "github", read: true, mutate: false },
            { id: "jira", read: false, mutate: false },
          ],
        },
      };
    },
    configuration: (binding: ProjectBinding) => configuration(ports.projects, binding),
    setTarget: service.setTarget,
    readBoard: service.read,
  };
}

export function createKanbanServerContribution(ports: KanbanPorts): PluginServerContribution {
  const handlers = createKanbanHandlers(ports);
  return (server) => {
    server.handle(getCapabilities, handlers.capabilities);
    server.handle(getProjectConfiguration, handlers.configuration);
    server.handle(setProjectTarget, handlers.setTarget);
    server.handle(getBoard, handlers.readBoard);
    return () => {};
  };
}
