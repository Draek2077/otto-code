import { createHash } from "node:crypto";
import { readProjectTarget } from "@getpaseo/plugin/server/otto-kanban";
import {
  failure,
  type Board,
  type BoardRead,
  type EditableBoard,
  type ProjectBinding,
  type BoardMutationIntent,
} from "@getpaseo/plugin/otto/kanban";
import type { OttoProjectMetadata } from "../../project-metadata.js";
import type { AtlassianAccountService } from "../../../../services/otto/atlassian/account.js";
import { createAtlassianHttp } from "../../../../services/otto/atlassian/http.js";
import { readJiraBoard } from "./reader.js";
import { readJiraCard, type JiraMutationContext } from "./details.js";
import { executeJiraCard } from "./execute.js";
import type { ProviderMutationResult } from "../mutations/service.js";
import { linkJiraIssue, type JiraBoardActionContext } from "./link.js";

export interface JiraHostContext {
  accountRevision: string;
  board: JiraBoardActionContext;
  card?: JiraMutationContext;
}
export class JiraBoardHost {
  constructor(
    private readonly ports: {
      hostId: string;
      metadata: Pick<OttoProjectMetadata, "read">;
      account: Pick<AtlassianAccountService, "read" | "resolve">;
      fetch?: typeof globalThis.fetch;
    },
  ) {}
  private async source(binding: ProjectBinding) {
    if (binding.hostId !== this.ports.hostId)
      return failure("wrong_host", "Choose this project's owning host.");
    const project = await this.ports.metadata.read(binding.projectId);
    const target = readProjectTarget(project.record);
    if (!target.ok) return target;
    if (target.value?.adapter !== "jira" || !target.value.boardId)
      return failure("invalid_target", "Configure this project's Jira board first.");
    const credential = await this.ports.account.resolve();
    if (!credential)
      return failure(
        "auth_required",
        "Configure the shared Atlassian account in this host's plugin settings to use Jira.",
      );
    if (!credential.siteUrl)
      return failure(
        "invalid_settings",
        "Set the Jira site in this host's shared Atlassian account settings.",
      );
    const http = createAtlassianHttp({ credential, fetch: this.ports.fetch });
    const read = await readJiraBoard({
      http,
      boardId: target.value.boardId,
      siteUrl: credential.siteUrl,
    });
    if (!read.ok) return read;
    // Native board IDs are site-local. Account/site changes must invalidate an
    // opened action even if two sites happen to return identical board data.
    const board = {
      ...read.value.board,
      revision: createHash("sha256")
        .update(
          JSON.stringify([credential.revision, credential.siteUrl, read.value.board.revision]),
        )
        .digest("hex"),
    };
    return {
      ok: true as const,
      value: {
        ...read.value,
        board,
        http,
        settingsRevision: project.revision,
        accountRevision: credential.revision,
        siteUrl: credential.siteUrl,
      },
    };
  }
  async readBoard(binding: ProjectBinding): Promise<BoardRead> {
    try {
      const source = await this.source(binding);
      return source.ok
        ? {
            status: "ready",
            binding,
            settingsRevision: source.value.settingsRevision,
            board: source.value.board,
          }
        : { status: "error", binding, error: source.error };
    } catch {
      return {
        status: "error",
        binding,
        error: {
          code: "unavailable",
          message:
            "The host could not read Jira or shared Atlassian authorization. Check this host's integration settings.",
        },
      };
    }
  }
  async editable(
    binding: ProjectBinding,
    initial: Board,
    settingsRevision: string,
    cardId?: string,
  ) {
    const source = await this.source(binding);
    if (!source.ok) return source;
    const value = source.value;
    if (initial.revision !== value.board.revision || settingsRevision !== value.settingsRevision)
      return failure(
        "revision_conflict",
        "The Jira board or shared account changed. Refresh before editing.",
      );
    const snapshot: EditableBoard = {
      board: { ...value.board, capabilities: { ...value.board.capabilities, link: true } },
      fields: [],
      cardFields: {},
      cardRevisions: {},
      allowedMoves: {},
    };
    const context: JiraHostContext = {
      accountRevision: value.accountRevision,
      board: {
        http: value.http,
        board: value.board,
        configuration: value.configuration,
        siteUrl: value.siteUrl,
      },
    };
    if (!cardId) return { ok: true as const, value: { settingsRevision, snapshot, context } };
    const card = await readJiraCard({
      http: value.http,
      board: snapshot.board,
      configuration: value.configuration,
      cardId,
    });
    return card.ok
      ? {
          ok: true as const,
          value: {
            settingsRevision,
            snapshot: card.value.snapshot,
            context: { ...context, card: card.value.context },
          },
        }
      : card;
  }
  async execute(
    intent: BoardMutationIntent,
    context: JiraHostContext,
  ): Promise<ProviderMutationResult> {
    if ((await this.ports.account.read()).revision !== context.accountRevision)
      return {
        status: "rejected",
        error: {
          code: "revision_conflict",
          message: "The shared Atlassian account changed. Refresh before applying this action.",
        },
      };
    if (intent.mutation.kind === "link")
      return linkJiraIssue(intent.mutation, context.board, async () => {
        const project = await this.ports.metadata.read(intent.binding.projectId);
        if (
          project.revision !== intent.expectedSettingsRevision ||
          (await this.ports.account.read()).revision !== context.accountRevision
        )
          return failure(
            "revision_conflict",
            "Project Settings or the shared account changed. Refresh before applying this action.",
          );
        return { ok: true, value: true };
      });
    if (!context.card)
      return {
        status: "rejected",
        error: { code: "unsupported", message: "Open a Jira issue before editing it." },
      };
    return executeJiraCard(intent, context.card);
  }
}
