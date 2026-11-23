import {
  failure,
  type BoardMutationIntent,
  type BoardFieldValue,
  type EditableBoard,
  type Result,
} from "@getpaseo/plugin/otto/kanban";

function validValue(snapshot: EditableBoard, fieldId: string, value: BoardFieldValue): boolean {
  const field = snapshot.fields.find((row) => row.id === fieldId);
  if (!field) return false;
  if (value.kind === "clear") return !field.required;
  if (field.required && value.kind === "text" && !value.value.trim()) return false;
  if (field.kind !== value.kind) return false;
  const choices = new Set(field.choices.map((choice) => choice.id));
  if (value.kind === "choice") return choices.has(value.id);
  if (value.kind === "choices" || value.kind === "people")
    return (
      new Set(value.ids).size === value.ids.length && value.ids.every((entry) => choices.has(entry))
    );
  if (value.kind === "date") {
    const date = new Date(value.value + "T00:00:00.000Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.value;
  }
  return true;
}
function validateCard(intent: BoardMutationIntent, snapshot: EditableBoard): Result<true> {
  const mutation = intent.mutation;
  if (!("cardId" in mutation)) return { ok: true, value: true };
  const card = snapshot.board.cards.find((row) => row.id === mutation.cardId);
  if (!card) return failure("not_found", "This card is no longer on the board. Refresh it.");
  if (snapshot.cardRevisions[mutation.cardId] !== mutation.expectedCardRevision)
    return failure("revision_conflict", "This card changed. Refresh before editing it.");
  if (
    mutation.kind === "move" &&
    !snapshot.allowedMoves[mutation.cardId]?.includes(mutation.columnId)
  )
    return failure("unsupported", "The provider does not allow this card to move to that column.");
  if (mutation.kind === "edit") {
    const allowed = snapshot.cardFields[mutation.cardId]?.some(
      (field) => field.fieldId === mutation.fieldId && field.editable,
    );
    if (!allowed || !validValue(snapshot, mutation.fieldId, mutation.value))
      return failure("unsupported", "This field or value is not editable for this card.");
  }
  return { ok: true, value: true };
}
export function preflightMutation(
  intent: BoardMutationIntent,
  snapshot: EditableBoard,
): Result<true> {
  if (
    snapshot.board.id !== intent.boardId ||
    snapshot.board.revision !== intent.expectedBoardRevision
  )
    return failure("revision_conflict", "The board changed. Refresh before applying this action.");
  if (!snapshot.board.capabilities[intent.mutation.kind])
    return failure("unsupported", "The provider does not support this action on this board.");
  const mutation = intent.mutation;
  if (
    (mutation.kind === "create" || mutation.kind === "link") &&
    mutation.columnId !== null &&
    !snapshot.board.columns.some((column) => column.id === mutation.columnId)
  )
    return failure("invalid_target", "Choose a current board column.");
  if (mutation.kind === "create" && !mutation.title.trim())
    return failure("invalid_target", "Enter a card title.");
  return validateCard(intent, snapshot);
}
