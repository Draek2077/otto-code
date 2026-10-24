/** One daemon-owned Kanban boundary. Clients supply identities, never paths or credentials. */
import {
  createKanbanHandlers,
  prepareTargetUpdate,
  type ProjectSnapshot,
  type ProjectBoardPort,
} from "@getpaseo/plugin/server/otto-kanban";
import {
  failure,
  getCapabilities,
  getProjectConfiguration,
  setProjectTarget,
  getBoard,
  type ProjectBinding,
  type Result,
} from "@getpaseo/plugin/otto/kanban";
import {
  OttoProjectMetadataError,
  type OttoProjectMetadata,
  type OttoProjectSnapshot,
} from "../project-metadata.js";
import type { GitHubProjectReads } from "../../../services/otto/github-projects.js";

function projectFailure(error: unknown): Result<never> {
  if (error instanceof OttoProjectMetadataError) {
    if (error.kind === "not_found")
      return failure("project_not_found", "Select an active project on this host.");
    if (error.kind === "conflict")
      return failure("revision_conflict", "Project Settings changed. Reload before saving.");
    return failure(
      "invalid_settings",
      "The preserved Project Settings need repair; they were left unchanged.",
    );
  }
  return failure("unavailable", "The owning host could not read or save Project Settings.");
}
export class KanbanDaemonService {
  private readonly handlers: ReturnType<typeof createKanbanHandlers>;
  constructor(
    private readonly ports: {
      hostId: string;
      metadata: Pick<OttoProjectMetadata, "read" | "update">;
      github: GitHubProjectReads;
    },
  ) {
    const projects: ProjectBoardPort = {
      hostId: ports.hostId,
      read: (binding) => this.readProject(binding),
      setTarget: async (input) => {
        const current = await this.readProject(input.binding);
        if (!current.ok) return current;
        const prepared = prepareTargetUpdate({
          snapshot: current.value,
          expectedRevision: input.expectedRevision,
          target: input.target,
        });
        if (!prepared.ok) return prepared;
        try {
          // Preparation cannot publish stale fields: the final CAS and write
          // occur inside the registry's shared mutation queue.
          const saved = await ports.metadata.update({
            projectId: input.binding.projectId,
            expectedRevision: input.expectedRevision,
            patch: { kanban: prepared.value.kanban },
          });
          return {
            ok: true,
            value: this.snapshot(input.binding, saved, current.value.githubRemote),
          };
        } catch (error) {
          return projectFailure(error);
        }
      },
    };
    this.handlers = createKanbanHandlers({
      projects,
      github: {
        hostId: ports.hostId,
        query: async (input) => {
          if (input.binding.hostId !== ports.hostId)
            return failure("wrong_host", "Select this project's owning host.");
          try {
            const project = await ports.metadata.read(input.binding.projectId);
            return ports.github.query({
              cwd: project.rootPath,
              document: input.document,
              variables: input.variables,
            });
          } catch (error) {
            return projectFailure(error);
          }
        },
      },
    });
  }
  private snapshot(
    binding: ProjectBinding,
    value: OttoProjectSnapshot,
    githubRemote: ProjectSnapshot["githubRemote"],
  ): ProjectSnapshot {
    return { binding, revision: value.revision, record: value.record, githubRemote };
  }
  private async readProject(binding: ProjectBinding): Promise<Result<ProjectSnapshot>> {
    if (binding.hostId !== this.ports.hostId)
      return failure("wrong_host", "Select this project's owning host.");
    try {
      const value = await this.ports.metadata.read(binding.projectId);
      const remote = await this.ports.github.repository(value.rootPath);
      return { ok: true, value: this.snapshot(binding, value, remote) };
    } catch (error) {
      return projectFailure(error);
    }
  }
  invoke(method: string, input: unknown): Promise<unknown> | undefined {
    switch (method) {
      case getCapabilities.name:
        return this.capabilities(input);
      case getProjectConfiguration.name:
        return this.configuration(input);
      case setProjectTarget.name:
        return this.setTarget(input);
      case getBoard.name:
        return this.board(input);
      default:
        return undefined;
    }
  }
  private async capabilities(input: unknown) {
    return getCapabilities.output.parse(
      this.handlers.capabilities(getCapabilities.input.parse(input)),
    );
  }
  private async configuration(input: unknown) {
    return getProjectConfiguration.output.parse(
      await this.handlers.configuration(getProjectConfiguration.input.parse(input)),
    );
  }
  private async setTarget(input: unknown) {
    return setProjectTarget.output.parse(
      await this.handlers.setTarget(setProjectTarget.input.parse(input)),
    );
  }
  private async board(input: unknown) {
    return getBoard.output.parse(await this.handlers.readBoard(getBoard.input.parse(input)));
  }
}
