import { createHash } from "node:crypto";
import { z } from "zod";
import { failure, type Board, type EditableBoard, type Result } from "@getpaseo/plugin/otto/kanban";
import type { GitHubProjectReads } from "../../../../services/otto/github-projects.js";
import {
  editableFieldsDocument,
  cardDetailsDocument,
  repositoryChoicesDocument,
} from "../../../../services/otto/github-project-details-documents.js";
import {
  FieldPageSchema,
  CardPageSchema,
  ChoicesPageSchema,
  type GitHubField,
  type GitHubContent,
  type GitHubValue,
  type RepoChoices,
} from "./github-schemas.js";
import {
  BODY_FIELD,
  cardField,
  fieldDefinition,
  fieldRoute,
  type FieldRoute,
} from "./github-fields.js";

export interface GitHubMutationContext {
  cwd: string;
  statusFieldId: string | null;
  routes: Map<string, FieldRoute>;
  content: GitHubContent | null;
}
type Query = (
  document: string,
  variables: Record<string, string | number | null>,
) => Promise<Result<unknown>>;
const EnvelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ type: z.string().optional() })).optional(),
});
const invalid = () =>
  failure(
    "invalid_response",
    "GitHub returned incomplete card editing metadata. Refresh the board.",
  );
export function detailQuery(port: GitHubProjectReads, cwd: string): Query {
  return async (document, variables) => {
    const response = await port.query({ cwd, document, variables });
    if (!response.ok) return response;
    const parsed = EnvelopeSchema.safeParse(response.value);
    if (!parsed.success) return invalid();
    if (parsed.data.errors?.length) {
      const types = new Set(parsed.data.errors.map((error) => error.type));
      if (types.has("INSUFFICIENT_SCOPES"))
        return failure(
          "scope_required",
          "GitHub CLI needs project write access and repo access for private contents on the selected host.",
        );
      if (types.has("FORBIDDEN"))
        return failure(
          "access_denied",
          "The host's GitHub account cannot edit this board or card.",
        );
      return failure(
        "unavailable",
        "GitHub could not read card editing metadata. Refresh the board.",
      );
    }
    return { ok: true, value: parsed.data.data };
  };
}
function cursor(
  page: { hasNextPage: boolean; endCursor: string | null },
  seen: Set<string>,
): string | null {
  if (!page.hasNextPage) return null;
  if (!page.endCursor || seen.has(page.endCursor)) throw new Error("Invalid pagination cursor");
  seen.add(page.endCursor);
  return page.endCursor;
}
async function fields(
  query: Query,
  board: Board,
): Promise<Result<{ rows: GitHubField[]; writable: boolean }>> {
  const rows: GitHubField[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  let writable = false;
  do {
    const result = await query(editableFieldsDocument, { id: board.id, cursor: after });
    if (!result.ok) return result;
    const response = FieldPageSchema.safeParse(result.value);
    if (!response.success || !response.data.node) return invalid();
    const node = response.data.node;
    if (node.id !== board.id || node.updatedAt !== board.revision)
      return failure("revision_conflict", "The board changed during this read. Refresh it.");
    if (rows.length && writable !== node.viewerCanUpdate) return invalid();
    writable = node.viewerCanUpdate;
    rows.push(...node.fields.nodes);
    after = cursor(node.fields.pageInfo, seen);
    if (rows.length > 500 || (rows.length >= 500 && after))
      return failure("read_limit", "This board exceeds Otto's 500-field editing limit.");
    if (after && !node.fields.nodes.length) return invalid();
  } while (after);
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return invalid();
  return { ok: true, value: { rows, writable } };
}
async function card(
  query: Query,
  boardId: string,
  cardId: string,
): Promise<Result<{ content: GitHubContent; values: GitHubValue[]; revision: string }>> {
  const values: GitHubValue[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  let header: string | undefined;
  let content: GitHubContent | null = null;
  do {
    const result = await query(cardDetailsDocument, { id: cardId, cursor: after });
    if (!result.ok) return result;
    const response = CardPageSchema.safeParse(result.value);
    if (!response.success) return invalid();
    const node = response.data.node;
    if (!node || node.id !== cardId || node.project.id !== boardId || !node.content)
      return failure("not_found", "This card is no longer accessible on the configured board.");
    const nextHeader = JSON.stringify([node.updatedAt, node.content]);
    if (header && header !== nextHeader)
      return failure("revision_conflict", "This card changed during the read. Refresh it.");
    header = nextHeader;
    content = node.content;
    if (
      content.assignees.pageInfo.hasNextPage ||
      ("labels" in content && content.labels.pageInfo.hasNextPage)
    )
      return failure(
        "read_limit",
        "This card exceeds Otto's 100-assignee or 100-label editing limit.",
      );
    values.push(...node.fieldValues.nodes);
    after = cursor(node.fieldValues.pageInfo, seen);
    if (values.length > 500 || (values.length >= 500 && after))
      return failure("read_limit", "This card exceeds Otto's 500-field editing limit.");
    if (after && !node.fieldValues.nodes.length) return invalid();
  } while (after);
  if (!content) return invalid();
  const ids = values.flatMap((value) => (value.field ? [value.field.id] : []));
  if (new Set(ids).size !== ids.length) return invalid();
  const revision = createHash("sha256")
    .update(JSON.stringify([header, values]))
    .digest("hex");
  return { ok: true, value: { content, values, revision } };
}
async function choices(
  query: Query,
  repository: { owner: string; repository: string } | null,
): Promise<Result<RepoChoices>> {
  const result: RepoChoices = { people: [], labels: [] };
  if (!repository) return { ok: true, value: result };
  let peopleCursor: string | null = null;
  let labelsCursor: string | null = null;
  let peopleDone = false;
  let labelsDone = false;
  const peopleSeen = new Set<string>();
  const labelsSeen = new Set<string>();
  do {
    const response = await query(repositoryChoicesDocument, {
      ...repository,
      peopleCursor,
      labelsCursor,
    });
    if (!response.ok) return response;
    const parsed = ChoicesPageSchema.safeParse(response.value);
    if (!parsed.success || !parsed.data.repository) return invalid();
    const node = parsed.data.repository;
    if (!peopleDone) {
      result.people.push(
        ...node.assignableUsers.nodes.map((row) => ({ id: row.id, label: row.login })),
      );
      peopleCursor = cursor(node.assignableUsers.pageInfo, peopleSeen);
      peopleDone = peopleCursor === null;
      if (!peopleDone && !node.assignableUsers.nodes.length) return invalid();
    }
    if (!labelsDone) {
      result.labels.push(...node.labels.nodes.map((row) => ({ id: row.id, label: row.name })));
      labelsCursor = cursor(node.labels.pageInfo, labelsSeen);
      labelsDone = labelsCursor === null;
      if (!labelsDone && !node.labels.nodes.length) return invalid();
    }
    if (result.people.length > 5000 || result.labels.length > 5000)
      return failure(
        "read_limit",
        "The repository exceeds Otto's 5,000-person or label editing limit.",
      );
  } while (!peopleDone || !labelsDone);
  if (
    new Set(result.people.map((row) => row.id)).size !== result.people.length ||
    new Set(result.labels.map((row) => row.id)).size !== result.labels.length
  )
    return invalid();
  return { ok: true, value: result };
}
function repositoryFor(
  content: GitHubContent,
  remote: { owner: string; repository: string } | null,
) {
  if (!("repository" in content)) return remote;
  const parts = content.repository.nameWithOwner.split("/");
  return parts.length === 2 && parts[0] && parts[1]
    ? { owner: parts[0], repository: parts[1] }
    : null;
}
export async function readGitHubEditing(input: {
  port: GitHubProjectReads;
  cwd: string;
  board: Board;
  cardId?: string;
  remote: { owner: string; repository: string } | null;
}): Promise<Result<{ snapshot: EditableBoard; context: GitHubMutationContext }>> {
  try {
    const query = detailQuery(input.port, input.cwd);
    const definitions = await fields(query, input.board);
    if (!definitions.ok) return definitions;
    const rows = definitions.value.rows;
    const status =
      rows.find((row) => row.dataType === "SINGLE_SELECT" && row.name.toLowerCase() === "status") ??
      rows.find((row) => row.dataType === "SINGLE_SELECT" && row.name.toLowerCase() === "state");
    const writable = definitions.value.writable;
    const context: GitHubMutationContext = {
      cwd: input.cwd,
      statusFieldId: status?.id ?? null,
      routes: new Map(rows.map((row) => [row.id, fieldRoute(row)])),
      content: null,
    };
    context.routes.set(BODY_FIELD, "body");
    const snapshot: EditableBoard = {
      board: {
        ...input.board,
        capabilities: {
          read: true,
          create: writable,
          link: writable,
          move: writable && Boolean(status),
          edit: writable,
          remove: writable,
        },
      },
      fields: rows.map((row) => fieldDefinition(row, { people: [], labels: [] })),
      cardFields: {},
      cardRevisions: {},
      allowedMoves: {},
    };
    snapshot.fields.push({ id: BODY_FIELD, name: "Description", kind: "text", choices: [] });
    if (!input.cardId) return { ok: true, value: { snapshot, context } };
    if (!input.board.cards.some((row) => row.id === input.cardId))
      return failure("not_found", "This card is no longer on the board.");
    const detail = await card(query, input.board.id, input.cardId);
    if (!detail.ok) return detail;
    const options = await choices(query, repositoryFor(detail.value.content, input.remote));
    if (!options.ok) return options;
    context.content = detail.value.content;
    const values = new Map(
      detail.value.values.flatMap((row) => (row.field ? [[row.field.id, row] as const] : [])),
    );
    snapshot.fields = rows.map((row) => fieldDefinition(row, options.value));
    snapshot.fields.push({ id: BODY_FIELD, name: "Description", kind: "text", choices: [] });
    snapshot.cardFields[input.cardId] = snapshot.fields.map((definition) =>
      cardField({
        definition,
        route: context.routes.get(definition.id) ?? "readonly",
        content: detail.value.content,
        value: values.get(definition.id),
        canUpdateProject: writable,
      }),
    );
    snapshot.cardRevisions[input.cardId] = detail.value.revision;
    snapshot.allowedMoves[input.cardId] =
      writable && status ? (status.options ?? []).map((row) => row.id) : [];
    snapshot.board.capabilities.edit = snapshot.cardFields[input.cardId]!.some(
      (row) => row.editable,
    );
    return { ok: true, value: { snapshot, context } };
  } catch {
    return invalid();
  }
}
