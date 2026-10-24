import type { Board, KanbanError, ProjectBinding } from "../shared/model.js";

// PROPOSAL ONLY: review the daemon-owned mutation boundary before implementing
// provider writes, registering mutation RPCs, or advertising mutation capability.
// No implementation, registration, auth lookup or network call lives here.

export type FieldInput =
  | { kind: "clear" }
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "date"; value: string }
  | { kind: "choice"; id: string }
  | { kind: "choices"; ids: string[] }
  | { kind: "people"; ids: string[] };

export type BoardMutation =
  | {
      kind: "create";
      title: string;
      description: string;
      columnId: string | null;
      fields: Record<string, FieldInput>;
    }
  | { kind: "link"; reference: string; columnId: string | null }
  | { kind: "move"; cardId: string; expectedCardRevision: string; columnId: string }
  | {
      kind: "edit";
      cardId: string;
      expectedCardRevision: string;
      fieldId: string;
      value: FieldInput;
    }
  | { kind: "remove"; cardId: string; expectedCardRevision: string };

export interface MutationIntent {
  binding: ProjectBinding;
  // Stable for one explicit user intent; never a vendor token or a session ID.
  operationId: string;
  boardId: string;
  expectedSettingsRevision: string;
  expectedBoardRevision: string;
  mutation: BoardMutation;
}

export interface BoardField {
  id: string;
  name: string;
  kind: string;
  choices: { id: string; label: string }[];
}

export interface EditableBoardSnapshot {
  board: Board;
  fields: BoardField[];
  // Field definitions are not a claim that every item can edit that field.
  cardFields: Record<
    string,
    { fieldId: string; editable: boolean; display: string; value: FieldInput | null }[]
  >;
  cardRevisions: Record<string, string>;
  // In particular, Jira workflow transitions are per issue, not per board.
  allowedMoves: Record<string, string[]>;
}

export type MutationOutcome =
  | { status: "applied"; operationId: string; snapshot: EditableBoardSnapshot }
  | { status: "rejected"; operationId: string; error: KanbanError }
  | { status: "reconciliation_required"; operationId: string; error: KanbanError };

export interface BoardMutationPort {
  readonly hostId: string;
  execute(intent: MutationIntent): Promise<MutationOutcome>;
}

// Host-side requirements for the eventual implementation:
// - Authorize execute separately from read; validate the host/project and read
//   its current target under the existing project store's revision-CAS boundary.
// - Resolve only that target; compare board/card revisions and membership, then
//   refresh operation-specific field/transition permissions before a write.
// - Use the existing GitHub forge CLI policy and shared official Atlassian auth;
//   never accept credentials, cwd, arbitrary URLs/endpoints or raw vendor bodies.
// - A revision check is an optimistic preflight, not a provider transaction or
//   guarantee against an external writer after the check. Advertise this limit.
// - Remember the operationId and exact intent before side effects. A retry of
//   a known applied/uncertain operation reconciles first, never blindly creates.
// - Re-read provider truth after success. If the write may have succeeded but
//   reconciliation fails, return reconciliation_required, not an ordinary retry.
// - GitHub removal detaches the project item; a linked issue/PR is retained.
//   Jira removal and synthetic Unassigned moves stay unsupported.
// - Keep field values beside cards and preserve unknown field kinds as display
//   only. GitHub drafts, issues and PRs have distinct editable capabilities.
// - Jira uses per-issue editmeta, board status mappings, workflow transitions
//   and ADF where required; Quick Filters never model writable membership.
// - Fixture tests come before any vendor write implementation. Live vendor
//   writes remain prohibited by the current task's authorization.
