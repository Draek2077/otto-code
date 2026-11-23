/** One daemon-owned Kanban boundary. Clients supply identities, never paths or credentials. */
import {
  createKanbanHandlers,
  prepareTargetUpdate,
  readProjectTarget,
  type ProjectSnapshot,
  type ProjectBoardPort,
} from "@getpaseo/plugin/server/otto-kanban";
import {
  failure,
  getCapabilities,
  getProjectConfiguration,
  setProjectTarget,
  getBoard,
  getEditableBoard,
  mutateBoard,
  getJiraCreateOptions,
  waitBoardChanges,
  releaseBoardChanges,
  type ProjectBinding,
  type Result,
} from "@getpaseo/plugin/otto/kanban";
import {
  OttoProjectMetadataError,
  type OttoProjectMetadata,
  type OttoProjectSnapshot,
} from "../project-metadata.js";
import type { GitHubProjectReads } from "../../../services/otto/github-projects.js";
import type { GitHubProjectWrites } from "../../../services/otto/github-project-commands.js";
import { KanbanEditingHost } from "./mutations/host.js";
import { JiraBoardHost } from "./jira/host.js";
import type { AtlassianAccountService } from "../../../services/otto/atlassian/account.js";
import { KanbanObservations } from "./observation.js";

function projectFailure(error: unknown): ReturnType<typeof failure> {
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
  get hostId() {
    return this.ports.hostId;
  }
  private readonly handlers: ReturnType<typeof createKanbanHandlers>;
  private readonly editing: KanbanEditingHost;
  private readonly jira: JiraBoardHost | null;
  private readonly observations = new KanbanObservations((binding) => this.readBoard(binding));
  constructor(
    private readonly ports: {
      hostId: string;
      metadata: Pick<OttoProjectMetadata, "read" | "update">;
      github: GitHubProjectReads;
      writes: GitHubProjectWrites;
      operationDirectory: string;
      atlassian?: AtlassianAccountService;
    },
  ) {
    this.jira = ports.atlassian
      ? new JiraBoardHost({
          hostId: ports.hostId,
          metadata: ports.metadata,
          account: ports.atlassian,
        })
      : null;
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
    this.editing = new KanbanEditingHost({
      hostId: ports.hostId,
      metadata: ports.metadata,
      reads: ports.github,
      writes: ports.writes,
      operationDirectory: ports.operationDirectory,
      readBoard: (binding) => this.readBoard(binding),
      jira: this.jira ?? undefined,
    });
  }
  private async readBoard(binding: ProjectBinding) {
    if (binding.hostId !== this.ports.hostId)
      return {
        status: "error" as const,
        binding,
        error: { code: "wrong_host" as const, message: "Select this project's owning host." },
      };
    try {
      const project = await this.ports.metadata.read(binding.projectId);
      const target = readProjectTarget(project.record);
      if (!target.ok) return { status: "error" as const, binding, error: target.error };
      if (target.value?.adapter === "jira" && this.jira) return this.jira.readBoard(binding);
      return this.handlers.readBoard(binding);
    } catch (error) {
      const result = projectFailure(error);
      return { status: "error" as const, binding, error: result.error };
    }
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
  invoke(method: string, input: unknown, clientId = ""): Promise<unknown> | undefined {
    switch (method) {
      case getCapabilities.name:
        return this.capabilities(input);
      case getProjectConfiguration.name:
        return this.configuration(input);
      case setProjectTarget.name:
        return this.setTarget(input);
      case getBoard.name:
        return this.board(input);
      case getEditableBoard.name:
        return this.editing.get(input);
      case mutateBoard.name:
        return this.editing.mutate(input);
      case getJiraCreateOptions.name:
        return this.creation(input);
      case waitBoardChanges.name:
        return this.observe(input, clientId);
      case releaseBoardChanges.name:
        return this.releaseObservation(input, clientId);
      default:
        return undefined;
    }
  }
  releaseClient(clientId: string) {
    this.observations.releaseClient(clientId);
  }
  close() {
    return this.observations.close();
  }
  private async observe(value: unknown, clientId: string) {
    const input = waitBoardChanges.input.parse(value);
    if (input.binding.hostId !== this.ports.hostId)
      return failure("wrong_host", "Select this project's owning host.");
    try {
      return waitBoardChanges.output.parse({
        ok: true,
        value: await this.observations.wait(clientId, input.leaseId, input.binding, input.cursor),
      });
    } catch {
      return failure(
        "unavailable",
        "Board polling stopped. Refresh to reconnect on the owning host.",
      );
    }
  }
  private async releaseObservation(value: unknown, clientId: string) {
    const input = releaseBoardChanges.input.parse(value);
    this.observations.release(clientId, input.leaseId);
    return releaseBoardChanges.output.parse({ ok: true, value: { released: true } });
  }
  private async capabilities(input: unknown) {
    const result = this.handlers.capabilities(getCapabilities.input.parse(input));
    if (result.ok) {
      const capability = { ...result.value, observe: true };
      capability.providers = capability.providers.map((provider) =>
        provider.id === "github" || (provider.id === "jira" && this.jira)
          ? { ...provider, read: true, mutate: true }
          : provider,
      );
      return getCapabilities.output.parse({ ok: true, value: capability });
    }
    return getCapabilities.output.parse(result);
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
    return getBoard.output.parse(await this.readBoard(getBoard.input.parse(input)));
  }
  private async creation(input: unknown) {
    try {
      const request = getJiraCreateOptions.input.parse(input);
      const result = this.jira
        ? await this.jira.creation(request)
        : failure(
            "unsupported",
            "Configure this host's shared Atlassian account to use Jira creation.",
          );
      return getJiraCreateOptions.output.parse(result);
    } catch {
      return getJiraCreateOptions.output.parse(
        failure(
          "unavailable",
          "Jira creation choices could not be loaded. Your draft is retained.",
        ),
      );
    }
  }
}
