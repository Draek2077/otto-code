import { z } from "zod";
import {
  BoardMutationIntentSchema,
  BoardMutationSchema,
  getBoard,
  getEditableBoard,
  getJiraCreateOptions,
  mutateBoard,
  failure,
  type ProjectBinding,
  type Board,
  type EditableBoard,
} from "@getpaseo/plugin/otto/kanban";
import type { KanbanDaemonService } from "./service.js";
import type { PaseoToolDefinition } from "../../agent/tools/types.js";

export class KanbanToolScopeError extends Error {}
const workspaceId = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Defaults to this chat's workspace. Outside a chat, supply an active workspace ID; a project path is never accepted.",
  );
const pageInput = z
  .object({
    workspaceId,
    cardId: z.string().min(1).optional(),
    fieldId: z.string().min(1).optional(),
    includeEditing: z.boolean().optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    expectedBoardRevision: z.string().min(1).optional(),
  })
  .strict();
const writeBase = BoardMutationIntentSchema.omit({ binding: true, mutation: true }).extend({
  workspaceId,
});
type Host = Pick<KanbanDaemonService, "invoke">;
type ResolveBinding = (requested?: string) => Promise<ProjectBinding>;
function boardMetadata(board: Board) {
  return {
    provider: board.provider,
    id: board.id,
    title: board.title,
    url: board.url,
    revision: board.revision,
    capabilities: board.capabilities,
    columns: board.columns,
  };
}
function bounded(result: unknown): unknown {
  return JSON.stringify(result).length <= 200000
    ? result
    : {
        status: "error",
        error: {
          code: "read_limit",
          message:
            "This Kanban response exceeds the tool budget. Request a single card or field, or use the tracker for this oversized field.",
        },
      };
}
function cardForTool(card: Board["cards"][number], details: boolean) {
  return {
    id: card.id,
    title: card.title.slice(0, 1024),
    titleTruncated: card.title.length > 1024,
    kind: card.kind,
    url: card.url,
    columnId: card.columnId,
    archived: card.archived,
    assignees: card.assignees,
    descriptionCharacters: card.description.length,
    ...(details
      ? {
          description: card.description.slice(0, 65536),
          descriptionTruncated: card.description.length > 65536,
        }
      : {}),
  };
}
function editingForTool(snapshot: EditableBoard, cardId: string, fieldId?: string) {
  return {
    cardRevision: snapshot.cardRevisions[cardId],
    allowedMoves: snapshot.allowedMoves[cardId],
    fields: snapshot.fields.map((field) => ({
      id: field.id,
      name: field.name,
      kind: field.kind,
      required: field.required,
      editable:
        snapshot.cardFields[cardId]?.find((value) => value.fieldId === field.id)?.editable === true,
    })),
    selectedField: fieldId
      ? {
          definition: snapshot.fields.find((field) => field.id === fieldId),
          value: snapshot.cardFields[cardId]?.find((field) => field.fieldId === fieldId),
        }
      : null,
  };
}
async function readPage(host: Host, binding: ProjectBinding, input: z.infer<typeof pageInput>) {
  if ((input.fieldId || input.includeEditing) && !input.cardId)
    return {
      status: "error",
      error: {
        code: "invalid_target",
        message: "Supply cardId before requesting editing metadata or an editable field.",
      },
    };
  const result =
    input.includeEditing || input.fieldId
      ? getEditableBoard.output.parse(
          await host.invoke(getEditableBoard.name, { binding, cardId: input.cardId }),
        )
      : getBoard.output.parse(await host.invoke(getBoard.name, binding));
  if (result.status !== "ready") return result;
  return projectBoardPage(result, input);
}
type ReadyBoardResult =
  | Extract<z.infer<typeof getBoard.output>, { status: "ready" }>
  | Extract<z.infer<typeof getEditableBoard.output>, { status: "ready" }>;
function projectBoardPage(result: ReadyBoardResult, input: z.infer<typeof pageInput>) {
  const binding = result.binding;
  const board = "snapshot" in result ? result.snapshot.board : result.board;
  if (input.expectedBoardRevision && input.expectedBoardRevision !== board.revision)
    return {
      status: "error",
      binding,
      error: {
        code: "revision_conflict",
        message:
          "The board changed between pages. Read the first page again before combining results.",
      },
    };
  const selected = input.cardId
    ? board.cards.filter((card) => card.id === input.cardId)
    : board.cards;
  if (input.cardId && !selected.length)
    return {
      status: "error",
      binding,
      error: { code: "not_found", message: "This card is no longer on the configured board." },
    };
  const offset = input.cardId ? 0 : (input.offset ?? 0);
  const end = offset + (input.limit ?? 50);
  const cards = selected.slice(offset, end).map((card) => cardForTool(card, Boolean(input.cardId)));
  const cardId = input.cardId;
  const editing =
    "snapshot" in result && cardId ? editingForTool(result.snapshot, cardId, input.fieldId) : null;
  if (input.fieldId && !editing?.selectedField?.definition)
    return {
      status: "error",
      binding,
      error: {
        code: "unsupported",
        message:
          "This card has no readable metadata for that field. Use a field ID returned by this host.",
      },
    };
  return bounded({
    status: "ready",
    binding,
    settingsRevision: result.settingsRevision,
    board: boardMetadata(board),
    cards,
    totalCards: selected.length,
    nextOffset: !input.cardId && end < selected.length ? end : null,
    editing,
  });
}

/** Every provider uses the existing host snapshot, metadata and durable mutation admission. */
export function createKanbanTools(host: Host, resolve: ResolveBinding): PaseoToolDefinition[] {
  const tool = <S extends z.ZodType>(
    name: string,
    description: string,
    schema: S,
    run: (input: z.infer<S>) => Promise<unknown>,
  ): PaseoToolDefinition => ({
    name,
    description,
    inputSchema: schema,
    async handler(raw) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success)
        return {
          content: [],
          isError: true,
          structuredContent: failure(
            "invalid_target",
            "Use the advertised Kanban inputs and fresh snapshot revisions. No paths, host IDs or credentials are accepted.",
          ),
        };
      try {
        const result = await run(parsed.data);
        const failed =
          typeof result === "object" &&
          result !== null &&
          (("status" in result &&
            (result.status === "error" ||
              result.status === "rejected" ||
              result.status === "reconciliation_required")) ||
            ("ok" in result && result.ok === false));
        return { content: [], structuredContent: result, ...(failed ? { isError: true } : {}) };
      } catch (error) {
        const message =
          error instanceof KanbanToolScopeError
            ? error.message
            : "The owning host could not acknowledge this Kanban operation. Inspect the board and reconcile an uncertain write before submitting anything else; do not automatically retry it.";
        return {
          content: [],
          isError: true,
          structuredContent: failure(
            error instanceof KanbanToolScopeError ? "access_denied" : "unavailable",
            message,
          ),
        };
      }
    },
  });
  const write = <S extends z.ZodType>(
    name: string,
    description: string,
    schema: S,
    mutation: (input: z.infer<S>) => z.infer<typeof BoardMutationSchema>,
  ) =>
    tool(
      name,
      `${description} First read the configured board/card to capture all revision IDs. Supply a stable operationId for this intent. Never resubmit an uncertain write under a new ID; refresh and reconcile instead.`,
      schema,
      async (input) => {
        const parsed = writeBase.strip().parse(input);
        const binding = await resolve(parsed.workspaceId);
        const outcome = mutateBoard.output.parse(
          await host.invoke(mutateBoard.name, {
            binding,
            operationId: parsed.operationId,
            boardId: parsed.boardId,
            expectedSettingsRevision: parsed.expectedSettingsRevision,
            expectedBoardRevision: parsed.expectedBoardRevision,
            mutation: mutation(input),
          }),
        );
        return outcome.status === "applied"
          ? {
              status: outcome.status,
              operationId: outcome.operationId,
              binding,
              boardId: outcome.snapshot.board.id,
              boardRevision: outcome.snapshot.board.revision,
              totalCards: outcome.snapshot.board.cards.length,
            }
          : outcome;
      },
    );
  const create = writeBase
    .extend(BoardMutationSchema.options[0].omit({ kind: true }).shape)
    .strict();
  const link = writeBase.extend(BoardMutationSchema.options[1].omit({ kind: true }).shape).strict();
  const move = writeBase.extend(BoardMutationSchema.options[2].omit({ kind: true }).shape).strict();
  const edit = writeBase.extend(BoardMutationSchema.options[3].omit({ kind: true }).shape).strict();
  const remove = writeBase
    .extend(BoardMutationSchema.options[4].omit({ kind: true }).shape)
    .strict();
  return [
    tool(
      "kanban_list_boards",
      "List only the board configured for this chat's project, with capabilities and counts, without injecting card bodies or discovering unrelated boards.",
      z.object({ workspaceId }).strict(),
      async (input) => {
        const binding = await resolve(input.workspaceId);
        const result = getBoard.output.parse(await host.invoke(getBoard.name, binding));
        if (result.status !== "ready") return result;
        return bounded({
          status: "ready",
          binding,
          settingsRevision: result.settingsRevision,
          boards: [{ ...boardMetadata(result.board), totalCards: result.board.cards.length }],
        });
      },
    ),
    tool(
      "kanban_get_board",
      "Read a configured board in bounded card-summary pages (default 50, max 100). Pass expectedBoardRevision when paging. Supply cardId for its body. Add includeEditing:true for its card revision and editable field IDs, or fieldId for that field's actual value/options. Ordinary card reads need no editing authority. Provider capabilities are authoritative.",
      pageInput,
      async (input) => readPage(host, await resolve(input.workspaceId), input),
    ),
    tool(
      "kanban_get_create_options",
      "Read Jira's board-associated project and issue-type choices before create. Pass fresh settings/board revisions; choose projectId then issueTypeId explicitly to obtain the create metadata revision. Unsupported required fields refuse creation instead of guessing values.",
      getJiraCreateOptions.input.omit({ binding: true }).extend({ workspaceId }).strict(),
      async (input) => {
        const { workspaceId: requested, ...options } = input;
        return bounded(
          getJiraCreateOptions.output.parse(
            await host.invoke(getJiraCreateOptions.name, {
              ...options,
              binding: await resolve(requested),
            }),
          ),
        );
      },
    ),
    write(
      "kanban_create_card",
      "Create one card using supported title/body and optional column. Jira additionally requires explicit project/type and captured creation-metadata revision.",
      create,
      (input) => ({
        kind: "create",
        title: input.title,
        description: input.description,
        columnId: input.columnId,
        ...(input.jira ? { jira: input.jira } : {}),
      }),
    ),
    write(
      "kanban_link_task",
      "Link an eligible existing issue/PR to this board. GitHub accepts supported issue/PR references; Jira accepts only an exact same-site issue already in this board's backlog. Never change a board filter to force membership.",
      link,
      (input) => ({ kind: "link", reference: input.reference, columnId: input.columnId }),
    ),
    write(
      "kanban_move_card",
      "Move a card only to a currently allowed column/native workflow transition. Synthetic or unsupported columns stay read-only.",
      move,
      (input) => ({
        kind: "move",
        cardId: input.cardId,
        expectedCardRevision: input.expectedCardRevision,
        columnId: input.columnId,
      }),
    ),
    write(
      "kanban_update_card",
      "Update one field using its host-issued field ID and typed value/options from kanban_get_board. Do not invent labels, people IDs or provider fields.",
      edit,
      (input) => ({
        kind: "edit",
        cardId: input.cardId,
        expectedCardRevision: input.expectedCardRevision,
        fieldId: input.fieldId,
        value: input.value,
      }),
    ),
    write(
      "kanban_delete_card",
      "Detach a card from the configured board when the provider supports it. This never deletes its underlying issue or pull request; Jira detach is unsupported.",
      remove,
      (input) => ({
        kind: "remove",
        cardId: input.cardId,
        expectedCardRevision: input.expectedCardRevision,
      }),
    ),
  ];
}
