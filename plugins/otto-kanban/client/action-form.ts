import {
  BoardFieldValueSchema,
  BoardMutationSchema,
  type BoardFieldValue,
  type BoardMutation,
  type BoardMutationIntent,
  type BoardMutationOutcome,
  type EditableBoard,
  type ProjectBinding,
} from "../shared/model.js";

export type ActionMode = BoardMutation["kind"];
export interface ActionOrigin {
  binding: ProjectBinding;
  settingsRevision: string;
  snapshot: EditableBoard;
  cardId?: string;
}
export interface ActionState {
  mode: ActionMode;
  title: string;
  description: string;
  reference: string;
  columnId: string;
  fieldId: string;
  value: BoardFieldValue;
  numberText: string;
  busy: boolean;
  dirty: boolean;
  blocked: boolean;
  saved: boolean;
  error: string;
  confirmRemove: boolean;
}
export function openBoardAction(input: {
  origin: ActionOrigin;
  mode: ActionMode;
  operationId(): string;
  submit(intent: BoardMutationIntent): Promise<BoardMutationOutcome>;
}) {
  const { origin } = input;
  const listeners = new Set<() => void>();
  let closed = false;
  let state: ActionState = {
    mode: input.mode,
    title: "",
    description: "",
    reference: "",
    columnId: "",
    fieldId: "",
    value: { kind: "clear" },
    numberText: "",
    busy: false,
    dirty: false,
    blocked: false,
    saved: false,
    error: "",
    confirmRemove: false,
  };
  function publish(next: Partial<ActionState>) {
    if (closed) return;
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }
  function edit(next: Partial<ActionState>) {
    if (!state.busy)
      publish({
        ...next,
        dirty: true,
        saved: false,
        confirmRemove: false,
        ...(state.blocked ? {} : { error: "" }),
      });
  }
  function field(fieldId: string) {
    const current = origin.cardId
      ? origin.snapshot.cardFields[origin.cardId]?.find((row) => row.fieldId === fieldId)
      : undefined;
    const value = current?.value ?? { kind: "clear" as const };
    edit({ fieldId, value, numberText: value.kind === "number" ? String(value.value) : "" });
  }
  function editedMutation(identity: {
    cardId: string;
    expectedCardRevision: string;
  }): BoardMutation | null {
    if (!state.fieldId) return null;
    const definition = origin.snapshot.fields.find((row) => row.id === state.fieldId);
    let value = state.value;
    if (
      definition?.required &&
      (value.kind === "clear" || (value.kind === "text" && !value.value.trim()))
    )
      return null;
    if (definition?.kind === "number" && value.kind !== "clear") {
      if (!state.numberText.trim() || !Number.isFinite(Number(state.numberText))) return null;
      value = { kind: "number", value: Number(state.numberText) };
    }
    if (
      !origin.snapshot.cardFields[identity.cardId]?.some(
        (row) => row.fieldId === state.fieldId && row.editable,
      ) ||
      !BoardFieldValueSchema.safeParse(value).success
    )
      return null;
    return { kind: "edit", ...identity, fieldId: state.fieldId, value };
  }
  function mutation(): BoardMutation | null {
    if (!origin.snapshot.board.capabilities[state.mode]) return null;
    if (state.mode === "create")
      return state.title.trim()
        ? {
            kind: "create",
            title: state.title,
            description: state.description,
            columnId: state.columnId || null,
          }
        : null;
    if (state.mode === "link")
      return state.reference.trim()
        ? { kind: "link", reference: state.reference.trim(), columnId: state.columnId || null }
        : null;
    const cardId = origin.cardId;
    const expectedCardRevision = cardId ? origin.snapshot.cardRevisions[cardId] : undefined;
    if (!cardId || !expectedCardRevision) return null;
    const identity = { cardId, expectedCardRevision };
    if (state.mode === "remove")
      return state.confirmRemove ? { kind: "remove", ...identity } : null;
    if (state.mode === "move")
      return origin.snapshot.allowedMoves[cardId]?.includes(state.columnId)
        ? { kind: "move", ...identity, columnId: state.columnId }
        : null;
    return editedMutation(identity);
  }
  function validMutation(): BoardMutation | null {
    const result = mutation();
    return result && BoardMutationSchema.safeParse(result).success ? result : null;
  }
  return {
    origin,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setMode(mode: ActionMode) {
      edit({ mode, fieldId: "", value: { kind: "clear" }, columnId: "" });
    },
    setTitle: (title: string) => edit({ title }),
    setDescription: (description: string) => edit({ description }),
    setReference: (reference: string) => edit({ reference }),
    setColumn: (columnId: string) => edit({ columnId }),
    setField: field,
    setValue: (value: BoardFieldValue) =>
      edit({ value, ...(value.kind === "clear" ? { numberText: "" } : {}) }),
    setNumber: (numberText: string) => edit({ numberText, value: { kind: "number", value: 0 } }),
    toggleChoice(id: string, selected: boolean) {
      const definition = origin.snapshot.fields.find((row) => row.id === state.fieldId);
      const ids = "ids" in state.value ? state.value.ids.filter((entry) => entry !== id) : [];
      if (selected) ids.push(id);
      edit({ value: { kind: definition?.kind === "people" ? "people" : "choices", ids } });
    },
    confirmRemove: () => {
      if (!state.busy) publish({ confirmRemove: true });
    },
    canSubmit: () => !closed && !state.busy && !state.blocked && validMutation() !== null,
    async submit(): Promise<BoardMutationOutcome | null> {
      if (closed || state.busy || state.blocked) return null;
      const action = validMutation();
      if (!action) {
        publish({ error: "Complete the required fields before applying this action." });
        return null;
      }
      const operation: BoardMutationIntent = {
        binding: origin.binding,
        operationId: input.operationId(),
        boardId: origin.snapshot.board.id,
        expectedSettingsRevision: origin.settingsRevision,
        expectedBoardRevision: origin.snapshot.board.revision,
        mutation: action,
      };
      publish({ busy: true, error: "" });
      try {
        const result = await input.submit(operation);
        if (result.operationId !== operation.operationId)
          throw new Error("Mismatched action result");
        if (result.status === "applied" && result.snapshot.board.id !== operation.boardId)
          throw new Error("Mismatched board result");
        if (result.status === "applied")
          publish({ busy: false, dirty: false, saved: true, blocked: true });
        else
          publish({
            busy: false,
            error: result.error.message,
            blocked:
              result.status === "reconciliation_required" ||
              result.error.code === "revision_conflict",
          });
        return result;
      } catch {
        publish({
          busy: false,
          blocked: true,
          error:
            "The response was lost. Check the provider and refresh before starting another action.",
        });
        return null;
      }
    },
    close() {
      closed = true;
      listeners.clear();
    },
  };
}
export type BoardActionModel = ReturnType<typeof openBoardAction>;

/** Deduplication identity, not an authorization token or credential. */
export function newBoardOperationId(): string {
  return `kanban-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
