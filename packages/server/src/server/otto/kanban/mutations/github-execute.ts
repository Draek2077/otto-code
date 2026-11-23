import { z } from "zod";
import {
  failure,
  type BoardFieldValue,
  type BoardMutationIntent,
  type EditableBoard,
  type Result,
} from "@getpaseo/plugin/otto/kanban";
import type { GitHubProjectReads } from "../../../../services/otto/github-projects.js";
import type {
  GitHubProjectWrites,
  GitHubBoardCommand,
} from "../../../../services/otto/github-project-commands.js";
import { linkContentDocument } from "../../../../services/otto/github-project-details-documents.js";
import { detailQuery, type GitHubMutationContext } from "./github-details.js";
import type { ProviderMutationResult } from "./service.js";

const unknown = (): ProviderMutationResult => ({
  status: "uncertain",
  error: {
    code: "unavailable",
    message:
      "GitHub may have applied this action. Refresh and reconcile the board before another action.",
  },
});
function reject(message: string): ProviderMutationResult {
  return { status: "rejected", error: { code: "invalid_target", message } };
}
function contentValue(
  field: "title" | "body" | "assigneeIds" | "labelIds",
  value: BoardFieldValue,
): string | string[] | null {
  if (field === "title" || field === "body") {
    if (value.kind === "clear") return field === "body" ? "" : null;
    if (value.kind !== "text" || (field === "title" && !value.value.trim())) return null;
    return value.value;
  }
  if (value.kind === "clear") return [];
  if (value.kind === "people" || value.kind === "choices") return value.ids;
  return null;
}
function editCommand(
  intent: BoardMutationIntent,
  context: GitHubMutationContext,
): Result<GitHubBoardCommand> {
  const mutation = intent.mutation;
  if (mutation.kind !== "edit") return failure("unsupported", "Choose a card field to edit.");
  const route = context.routes.get(mutation.fieldId);
  if (!route || route === "readonly") return failure("unsupported", "This field is read-only.");
  const item = { projectId: intent.boardId, itemId: mutation.cardId, fieldId: mutation.fieldId };
  if (route === "project")
    return { ok: true, value: { kind: "field", ...item, value: mutation.value } };
  if (route === "iteration") {
    if (mutation.value.kind === "clear")
      return { ok: true, value: { kind: "field", ...item, value: mutation.value } };
    return mutation.value.kind === "choice"
      ? { ok: true, value: { kind: "iteration", ...item, iterationId: mutation.value.id } }
      : failure("invalid_target", "Choose a current iteration.");
  }
  if (!context.content) return failure("not_found", "The underlying work item is unavailable.");
  const value = contentValue(route, mutation.value);
  if (value === null) return failure("invalid_target", "Enter a supported value for this field.");
  return {
    ok: true,
    value: {
      kind: "content",
      contentKind: context.content.__typename,
      contentId: context.content.id,
      field: route,
      value,
    },
  };
}
function referenceUrl(reference: string, boardUrl: string | null): string | null {
  if (!boardUrl) return null;
  try {
    const board = new URL(boardUrl);
    const url = new URL(reference);
    if (
      url.protocol !== "https:" ||
      url.origin !== board.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return /^\/[^/]+\/[^/]+\/(issues|pull)\/[1-9]\d*\/?$/.test(url.pathname)
      ? url.href.replace(/\/$/, "")
      : null;
  } catch {
    return null;
  }
}
async function linkedContent(
  port: GitHubProjectReads,
  context: GitHubMutationContext,
  snapshot: EditableBoard,
  reference: string,
): Promise<Result<string>> {
  const url = referenceUrl(reference, snapshot.board.url);
  if (!url)
    return failure(
      "invalid_target",
      "Paste an issue or pull request HTTPS URL from this board's GitHub host.",
    );
  if (snapshot.board.cards.some((card) => card.url?.replace(/\/$/, "") === url))
    return failure("invalid_target", "This issue or pull request is already on the board.");
  const response = await detailQuery(port, context.cwd)(linkContentDocument, { url });
  if (!response.ok) return response;
  const resource = z
    .object({
      resource: z
        .discriminatedUnion("__typename", [
          z.object({ __typename: z.literal("Issue"), id: z.string(), url: z.string() }),
          z.object({ __typename: z.literal("PullRequest"), id: z.string(), url: z.string() }),
        ])
        .nullable(),
    })
    .safeParse(response.value);
  if (
    !resource.success ||
    !resource.data.resource ||
    resource.data.resource.url.replace(/\/$/, "") !== url
  )
    return failure("not_found", "The host cannot access that issue or pull request.");
  return { ok: true, value: resource.data.resource.id };
}
function placement(
  intent: BoardMutationIntent,
  context: GitHubMutationContext,
  snapshot: EditableBoard,
): ProviderMutationResult | null {
  const mutation = intent.mutation;
  if (mutation.kind !== "create" && mutation.kind !== "link") return null;
  if (mutation.columnId === null) return null;
  const status = snapshot.fields.find((field) => field.id === context.statusFieldId);
  if (!status?.choices.some((choice) => choice.id === mutation.columnId))
    return reject("Choose a writable status column, or leave the card unassigned.");
  return null;
}
export async function executeGitHubMutation(input: {
  intent: BoardMutationIntent;
  snapshot: EditableBoard;
  context: GitHubMutationContext;
  reads: GitHubProjectReads;
  writes: GitHubProjectWrites;
}): Promise<ProviderMutationResult> {
  const { intent, snapshot, context, writes } = input;
  const mutation = intent.mutation;
  const invalidPlacement = placement(intent, context, snapshot);
  if (mutation.kind === "create" && mutation.jira)
    return reject("Jira creation settings cannot be applied to a GitHub board.");
  if (invalidPlacement) return invalidPlacement;
  let command: GitHubBoardCommand;
  switch (mutation.kind) {
    case "create":
      command = {
        kind: "create",
        projectId: intent.boardId,
        title: mutation.title,
        body: mutation.description,
      };
      break;
    case "link": {
      const content = await linkedContent(input.reads, context, snapshot, mutation.reference);
      if (!content.ok) return { status: "rejected", error: content.error };
      command = { kind: "link", projectId: intent.boardId, contentId: content.value };
      break;
    }
    case "move": {
      if (!context.statusFieldId) return reject("This board has no writable status field.");
      command = {
        kind: "field",
        projectId: intent.boardId,
        itemId: mutation.cardId,
        fieldId: context.statusFieldId,
        value: { kind: "choice", id: mutation.columnId },
      };
      break;
    }
    case "remove":
      command = { kind: "remove", projectId: intent.boardId, itemId: mutation.cardId };
      break;
    case "edit": {
      const edited = editCommand(intent, context);
      if (!edited.ok) return { status: "rejected", error: edited.error };
      command = edited.value;
      break;
    }
  }
  const written = await writes.execute({ cwd: context.cwd, command });
  if (written.status !== "applied") return unknown();
  if (
    (mutation.kind === "create" || mutation.kind === "link") &&
    mutation.columnId !== null &&
    context.statusFieldId
  ) {
    const moved = await writes.execute({
      cwd: context.cwd,
      command: {
        kind: "field",
        projectId: intent.boardId,
        itemId: written.id,
        fieldId: context.statusFieldId,
        value: { kind: "choice", id: mutation.columnId },
      },
    });
    if (moved.status !== "applied") return unknown();
  }
  return { status: "applied" };
}
