import { failure, type Board, type BoardMutation, type Result } from "@getpaseo/plugin/otto/kanban";
import type { AtlassianHttp } from "../../../../services/otto/atlassian/http.js";
import type { ProviderMutationResult } from "../mutations/service.js";
import { JiraIssuePageSchema, type JiraConfiguration } from "./schemas.js";
import { readJiraBoard } from "./reader.js";
import { readJiraCard } from "./details.js";
import { moveJiraIssue } from "./execute.js";

export interface JiraBoardActionContext {
  http: AtlassianHttp;
  board: Board;
  configuration: JiraConfiguration;
  siteUrl: string;
}
function issueKey(reference: string, siteUrl: string): string | null {
  if (/^[A-Za-z][A-Za-z0-9_]*-[1-9]\d*$/.test(reference)) return reference;
  try {
    const url = new URL(reference);
    if (
      url.origin !== new URL(siteUrl).origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return /^\/browse\/([A-Za-z][A-Za-z0-9_]*-[1-9]\d*)\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}
const reconcile = (): ProviderMutationResult => ({
  status: "uncertain",
  error: {
    code: "unavailable",
    message: "The Jira issue may have moved. Check the board and backlog before another action.",
  },
});
async function verifyBacklog(context: JiraBoardActionContext, key: string): Promise<Result<true>> {
  if (context.board.cards.some((card) => card.id === key))
    return failure(
      "invalid_target",
      "This issue is already on the board. Open it to edit or move it.",
    );
  const query = new URLSearchParams({
    jql: `key = "${key}"`,
    fields: "summary,status,updated",
    maxResults: "2",
  });
  const result = await context.http.read(
    `/rest/software/1.0/board/${context.board.id}/backlog?${query}`,
  );
  if (!result.ok) return result;
  const page = JiraIssuePageSchema.safeParse(result.value);
  if (!page.success || !page.data.isLast || page.data.nextPageToken || page.data.issues.length > 1)
    return failure("invalid_response", "Jira returned incomplete or ambiguous backlog membership.");
  return page.data.issues[0]?.key === key
    ? { ok: true, value: true }
    : failure(
        "invalid_target",
        "Choose an issue already in this board's backlog. Linking never changes the board filter.",
      );
}
async function placeLinkedIssue(
  context: JiraBoardActionContext,
  key: string,
  columnId: string | null,
  beforeWrite: () => Promise<Result<true>>,
): Promise<ProviderMutationResult> {
  const current = await readJiraBoard({
    http: context.http,
    boardId: context.board.id,
    siteUrl: context.siteUrl,
  });
  if (!current.ok) return reconcile();
  const card = current.value.board.cards.find((row) => row.id === key);
  if (!card) return reconcile();
  if (columnId === null || card.columnId === columnId) return { status: "applied" };
  const editable = await readJiraCard({
    http: context.http,
    board: current.value.board,
    configuration: current.value.configuration,
    cardId: key,
  });
  if (!editable.ok || !editable.value.context.transitions.has(columnId)) return reconcile();
  const ready = await beforeWrite();
  if (!ready.ok) return reconcile();
  const result = await moveJiraIssue(columnId, editable.value.context);
  if (result.status !== "applied") return reconcile();
  const placed = await readJiraBoard({
    http: context.http,
    boardId: context.board.id,
    siteUrl: context.siteUrl,
  });
  return placed.ok &&
    placed.value.board.cards.some((row) => row.id === key && row.columnId === columnId)
    ? { status: "applied" }
    : reconcile();
}
/** Jira's official board action accepts only its existing backlog, never arbitrary
 * cross-project membership. The durable admission/receipt stays in BoardMutationService. */
export async function linkJiraIssue(
  mutation: Extract<BoardMutation, { kind: "link" }>,
  context: JiraBoardActionContext,
  beforeWrite: () => Promise<Result<true>>,
): Promise<ProviderMutationResult> {
  const key = issueKey(mutation.reference, context.siteUrl);
  if (!key)
    return {
      status: "rejected",
      error: {
        code: "invalid_target",
        message: "Enter an issue key or a browse URL on this host's configured Jira site.",
      },
    };
  if (
    mutation.columnId !== null &&
    !context.configuration.columnConfig.columns.some((column) => column.name === mutation.columnId)
  )
    return {
      status: "rejected",
      error: { code: "invalid_target", message: "Choose a current Jira column." },
    };
  const membership = await verifyBacklog(context, key);
  if (!membership.ok) return { status: "rejected", error: membership.error };
  const ready = await beforeWrite();
  if (!ready.ok) return { status: "rejected", error: ready.error };
  const result = await context.http.write(
    "POST",
    `/rest/agile/1.0/board/${context.board.id}/issue`,
    { issues: [key] },
  );
  if (result.status !== "applied") return result;
  return placeLinkedIssue(context, key, mutation.columnId, beforeWrite);
}
