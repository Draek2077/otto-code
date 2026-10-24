import { z } from "zod";
import { defineRpc } from "../../../rpc.js";
import { BoardSchema, KanbanErrorSchema, ProjectBindingSchema } from "./model.js";

const id = z.string().min(1).max(512);
export const BoardFieldValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clear") }).strict(),
  z.object({ kind: z.literal("text"), value: z.string().max(65_536) }).strict(),
  z.object({ kind: z.literal("number"), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal("date"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ kind: z.literal("choice"), id }).strict(),
  z.object({ kind: z.literal("choices"), ids: z.array(id).max(100) }).strict(),
  z.object({ kind: z.literal("people"), ids: z.array(id).max(100) }).strict(),
]);
export type BoardFieldValue = z.infer<typeof BoardFieldValueSchema>;

const cardIdentity = { cardId: id, expectedCardRevision: id };
export const BoardMutationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("create"),
      title: z.string().min(1).max(1024),
      description: z.string().max(65_536),
      columnId: id.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("link"),
      reference: z.string().min(1).max(2048),
      columnId: id.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("move"), ...cardIdentity, columnId: id }).strict(),
  z
    .object({ kind: z.literal("edit"), ...cardIdentity, fieldId: id, value: BoardFieldValueSchema })
    .strict(),
  z.object({ kind: z.literal("remove"), ...cardIdentity }).strict(),
]);
export type BoardMutation = z.infer<typeof BoardMutationSchema>;
export const BoardMutationIntentSchema = z
  .object({
    binding: ProjectBindingSchema.strict(),
    operationId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    boardId: id,
    expectedSettingsRevision: id,
    expectedBoardRevision: id,
    mutation: BoardMutationSchema,
  })
  .strict();
export type BoardMutationIntent = z.infer<typeof BoardMutationIntentSchema>;

export const EditableBoardSchema = z.object({
  board: BoardSchema,
  fields: z.array(
    z.object({
      id,
      name: z.string(),
      kind: z.string(),
      required: z.boolean().optional(),
      choices: z.array(z.object({ id, label: z.string() })),
    }),
  ),
  cardFields: z.record(
    z.string(),
    z.array(
      z.object({
        fieldId: id,
        editable: z.boolean(),
        display: z.string(),
        value: BoardFieldValueSchema.nullable(),
      }),
    ),
  ),
  cardRevisions: z.record(z.string(), id),
  allowedMoves: z.record(z.string(), z.array(id)),
});
export type EditableBoard = z.infer<typeof EditableBoardSchema>;
export const BoardMutationOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("applied"), operationId: id, snapshot: EditableBoardSchema }),
  z.object({ status: z.literal("rejected"), operationId: id, error: KanbanErrorSchema }),
  z.object({
    status: z.literal("reconciliation_required"),
    operationId: id,
    error: KanbanErrorSchema,
  }),
]);
export type BoardMutationOutcome = z.infer<typeof BoardMutationOutcomeSchema>;

export const getEditableBoard = defineRpc({
  name: "kanban.board.get_editable",
  input: z.object({ binding: ProjectBindingSchema.strict(), cardId: id.optional() }).strict(),
  output: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("unconfigured"),
      binding: ProjectBindingSchema,
      settingsRevision: id,
    }),
    z.object({
      status: z.literal("ready"),
      binding: ProjectBindingSchema,
      settingsRevision: id,
      snapshot: EditableBoardSchema,
    }),
    z.object({
      status: z.literal("error"),
      binding: ProjectBindingSchema,
      error: KanbanErrorSchema,
    }),
  ]),
});
export const mutateBoard = defineRpc({
  name: "kanban.board.mutate",
  input: BoardMutationIntentSchema,
  output: BoardMutationOutcomeSchema,
});
