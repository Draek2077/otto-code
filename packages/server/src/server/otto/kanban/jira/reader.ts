import { createHash } from "node:crypto";
import { failure, type Board, type Result } from "@getpaseo/plugin/otto/kanban";
import type { AtlassianHttp } from "../../../../services/otto/atlassian/http.js";
import {
  JiraConfigurationSchema,
  JiraIssuePageSchema,
  type JiraConfiguration,
  type JiraIssue,
} from "./schemas.js";
import { jiraDescription } from "./adf.js";

export const JIRA_UNASSIGNED = "otto:unassigned";
interface JiraBoardState {
  board: Board;
  configuration: JiraConfiguration;
  issues: JiraIssue[];
}
function layout(
  config: JiraConfiguration,
): Result<{ columns: Board["columns"]; statuses: Map<string, string> }> {
  const columns = config.columnConfig.columns.map((column) => ({
    id: column.name,
    title: column.name,
  }));
  if (new Set(columns.map((column) => column.id)).size !== columns.length)
    return failure(
      "unsupported",
      "This Jira board has duplicate column names. Give its columns unique names.",
    );
  const statuses = new Map<string, string>();
  for (const column of config.columnConfig.columns)
    for (const status of column.statuses) {
      const key = String(status.id);
      if (statuses.has(key))
        return failure("invalid_response", "Jira mapped one status to multiple board columns.");
      statuses.set(key, column.name);
    }
  columns.push({ id: JIRA_UNASSIGNED, title: "Unassigned" });
  return { ok: true, value: { columns, statuses } };
}
async function issues(http: AtlassianHttp, boardId: string): Promise<Result<JiraIssue[]>> {
  const rows: JiraIssue[] = [];
  const ids = new Set<string>();
  const seen = new Set<string>();
  let next: string | undefined;
  do {
    const query = new URLSearchParams({
      maxResults: "100",
      fields: "summary,description,status,assignee,labels,priority,duedate,updated,project",
    });
    if (next) query.set("nextPageToken", next);
    // Current Cloud API uses token pagination; the older Agile issue endpoint is deprecated.
    const result = await http.read(`/rest/software/1.0/board/${boardId}/issue?${query}`);
    if (!result.ok) return result;
    const parsed = JiraIssuePageSchema.safeParse(result.value);
    if (!parsed.success)
      return failure("invalid_response", "Jira returned an incomplete board issue page.");
    for (const issue of parsed.data.issues) {
      if (ids.has(issue.key))
        return failure(
          "revision_conflict",
          "The Jira board changed during pagination. Refresh it.",
        );
      ids.add(issue.key);
      rows.push(issue);
    }
    if (rows.length > 2000 || (rows.length >= 2000 && !parsed.data.isLast))
      return failure("read_limit", "This board exceeds Otto's 2,000-card read limit.");
    if (parsed.data.isLast) break;
    next = parsed.data.nextPageToken;
    if (!next || seen.has(next) || !parsed.data.issues.length)
      return failure("invalid_response", "Jira returned incomplete or repeated board pagination.");
    seen.add(next);
  } while (next);
  return { ok: true, value: rows };
}
function projectCards(
  rows: JiraIssue[],
  statuses: Map<string, string>,
  siteUrl: string,
): Result<Board["cards"]> {
  const cards: Board["cards"] = [];
  for (const issue of rows) {
    const description = jiraDescription(issue.fields.description);
    if (!description.ok) return description;
    cards.push({
      id: issue.key,
      title: issue.fields.summary,
      description: description.value,
      url: `${siteUrl}/browse/${encodeURIComponent(issue.key)}`,
      columnId: statuses.get(String(issue.fields.status.id)) ?? JIRA_UNASSIGNED,
      kind: "Issue",
      assignees: issue.fields.assignee ? [issue.fields.assignee.displayName] : [],
      archived: false,
    });
  }
  return { ok: true, value: cards };
}
export async function readJiraBoard(input: {
  http: AtlassianHttp;
  boardId: string;
  siteUrl: string;
}): Promise<Result<JiraBoardState>> {
  if (!/^[1-9]\d*$/.test(input.boardId))
    return failure("invalid_target", "Choose a numeric Jira board identifier.");
  const result = await input.http.read(`/rest/agile/1.0/board/${input.boardId}/configuration`);
  if (!result.ok) return result;
  const config = JiraConfigurationSchema.safeParse(result.value);
  if (!config.success || String(config.data.id) !== input.boardId)
    return failure(
      "invalid_response",
      "Jira returned configuration for an invalid or different board.",
    );
  const mapped = layout(config.data);
  if (!mapped.ok) return mapped;
  const rows = await issues(input.http, input.boardId);
  if (!rows.ok) return rows;
  const cards = projectCards(rows.value, mapped.value.statuses, input.siteUrl);
  if (!cards.ok) return cards;
  const finalConfig = await input.http.read(`/rest/agile/1.0/board/${input.boardId}/configuration`);
  if (!finalConfig.ok) return finalConfig;
  const final = JiraConfigurationSchema.safeParse(finalConfig.value);
  if (!final.success || JSON.stringify(final.data) !== JSON.stringify(config.data))
    return failure(
      "revision_conflict",
      "Jira's column configuration changed during this read. Refresh it.",
    );
  const revision = createHash("sha256")
    .update(JSON.stringify([config.data, rows.value]))
    .digest("hex");
  return {
    ok: true,
    value: {
      configuration: config.data,
      issues: rows.value,
      board: {
        provider: "jira",
        id: input.boardId,
        title: config.data.name,
        url: `${input.siteUrl}/secure/RapidBoard.jspa?rapidView=${input.boardId}`,
        revision,
        columns: mapped.value.columns,
        cards: cards.value,
        capabilities: {
          read: true,
          create: false,
          link: false,
          move: false,
          edit: false,
          remove: false,
        },
      },
    },
  };
}
