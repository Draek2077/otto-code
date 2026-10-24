import {
  failure,
  getEditableBoard,
  mutateBoard,
  type BoardRead,
  type ProjectBinding,
  type Result,
} from "@getpaseo/plugin/otto/kanban";
import type { OttoProjectMetadata } from "../../project-metadata.js";
import type { GitHubProjectReads } from "../../../../services/otto/github-projects.js";
import type { GitHubProjectWrites } from "../../../../services/otto/github-project-commands.js";
import { readGitHubEditing, type GitHubMutationContext } from "./github-details.js";
import { executeGitHubMutation } from "./github-execute.js";
import { BoardMutationService } from "./service.js";
import { FileMutationStore } from "./store.js";

interface Ports {
  hostId: string;
  metadata: Pick<OttoProjectMetadata, "read">;
  reads: GitHubProjectReads;
  writes: GitHubProjectWrites;
  readBoard(binding: ProjectBinding): Promise<BoardRead>;
  operationDirectory: string;
}
export class KanbanEditingHost {
  private readonly mutations: BoardMutationService<GitHubMutationContext>;
  constructor(private readonly ports: Ports) {
    this.mutations = new BoardMutationService({
      hostId: ports.hostId,
      store: new FileMutationStore(ports.operationDirectory),
      read: (binding, cardId) => this.read(binding, cardId),
      checkSettings: (binding, revision) => this.checkSettings(binding, revision),
      execute: async (intent, snapshot, context) => {
        if (!context)
          return {
            status: "rejected",
            error: { code: "unavailable", message: "Refresh the board before applying an action." },
          };
        return executeGitHubMutation({
          intent,
          snapshot,
          context,
          reads: ports.reads,
          writes: ports.writes,
        });
      },
    });
  }
  private async read(binding: ProjectBinding, cardId?: string) {
    const board = await this.ports.readBoard(binding);
    if (board.status === "error") return { ok: false as const, error: board.error };
    if (board.status === "unconfigured")
      return failure("invalid_target", "Configure a project board before editing cards.");
    return this.readReady(binding, board, cardId);
  }
  private async readReady(
    binding: ProjectBinding,
    board: Extract<BoardRead, { status: "ready" }>,
    cardId?: string,
  ) {
    if (board.board.provider !== "github")
      return failure("unsupported", "Editing is not supported by this board provider.");
    const project = await this.ports.metadata.read(binding.projectId);
    if (project.revision !== board.settingsRevision)
      return failure("revision_conflict", "Project Settings changed. Reload the board.");
    const remote = await this.ports.reads.repository(project.rootPath);
    const result = await readGitHubEditing({
      port: this.ports.reads,
      cwd: project.rootPath,
      board: board.board,
      cardId,
      remote,
    });
    return result.ok
      ? { ok: true as const, value: { settingsRevision: board.settingsRevision, ...result.value } }
      : result;
  }
  private async checkSettings(binding: ProjectBinding, revision: string): Promise<Result<true>> {
    const project = await this.ports.metadata.read(binding.projectId);
    return project.revision === revision
      ? { ok: true, value: true }
      : failure(
          "revision_conflict",
          "Project Settings changed. Reload before applying this action.",
        );
  }
  async get(input: unknown) {
    const parsed = getEditableBoard.input.parse(input);
    const initial = await this.ports.readBoard(parsed.binding);
    if (initial.status !== "ready") return getEditableBoard.output.parse(initial);
    try {
      const read = await this.readReady(parsed.binding, initial, parsed.cardId);
      return getEditableBoard.output.parse(
        read.ok
          ? {
              status: "ready",
              binding: parsed.binding,
              settingsRevision: read.value.settingsRevision,
              snapshot: read.value.snapshot,
            }
          : { status: "error", binding: parsed.binding, error: read.error },
      );
    } catch {
      return getEditableBoard.output.parse({
        status: "error",
        binding: parsed.binding,
        error: {
          code: "unavailable",
          message: "The owning host could not read editing metadata. Refresh the board.",
        },
      });
    }
  }
  async mutate(input: unknown) {
    return mutateBoard.output.parse(await this.mutations.execute(mutateBoard.input.parse(input)));
  }
}
