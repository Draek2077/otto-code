import { createHash } from "node:crypto";
import { z } from "zod";
import { failure, type JiraCreateOptions, type Result } from "@getpaseo/plugin/otto/kanban";
import type { AtlassianHttp } from "../../../../services/otto/atlassian/http.js";
import type { JiraBoardActionContext } from "./link.js";
import { JiraEditFieldSchema, jiraFieldPlan, type JiraEditField } from "./fields.js";

const PageSchema = z.object({
  startAt: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
const ProjectSchema = z.object({
  id: z.union([z.string().min(1), z.number().int()]),
  key: z.string(),
  name: z.string(),
});
const TypeSchema = z.object({ id: z.string().min(1), name: z.string(), subtask: z.boolean() });
const FieldSchema = JiraEditFieldSchema.extend({
  fieldId: z.string().min(1),
  required: z.boolean(),
});
/** Metadata pagination must be complete and stable; never turn a partial create
 * screen into authorization to omit one of Jira's required fields. */
async function pages<T>(
  http: AtlassianHttp,
  endpoint: string,
  key: string,
  schema: z.ZodType<T>,
  limit: number,
): Promise<Result<T[]>> {
  const rows: T[] = [];
  let total: number | null = null;
  do {
    const query = new URLSearchParams({ startAt: String(rows.length), maxResults: "50" });
    const response = await http.read(endpoint + "?" + query);
    if (!response.ok) return response;
    const page = PageSchema.safeParse(response.value);
    const items = z.object({ [key]: z.array(schema).max(50) }).safeParse(response.value);
    if (!page.success || !items.success)
      return failure("invalid_response", "Jira returned incomplete creation metadata.");
    const data = z.array(schema).parse(items.data[key]);
    if (
      page.data.startAt !== rows.length ||
      (total !== null && page.data.total !== total) ||
      (!data.length && page.data.total > rows.length)
    )
      return failure(
        "revision_conflict",
        "Jira's creation choices changed during pagination. Reload them.",
      );
    total = page.data.total;
    if (total > limit)
      return failure(
        "read_limit",
        "This Jira creation screen exceeds Otto's metadata selection limit.",
      );
    rows.push(...data);
    if (rows.length > total)
      return failure("invalid_response", "Jira returned inconsistent creation pagination.");
  } while (rows.length < total);
  return { ok: true, value: rows };
}
function unique(ids: string[]) {
  return new Set(ids).size === ids.length;
}
function unavailableReason(
  summary: JiraEditField | undefined,
  blockers: JiraEditField[],
): string | null {
  if (summary?.schema?.type !== "string" || !jiraFieldPlan("summary", summary, []).writable)
    return "This Jira issue type does not expose an editable title. Use its creation screen in Jira.";
  if (blockers.length)
    return (
      "Create this issue in Jira, then link it from the board backlog. Jira requires additional fields: " +
      blockers.map((field) => field.name).join(", ")
    );
  return null;
}
export interface JiraCreationMetadata {
  options: JiraCreateOptions;
  fields: Map<string, JiraEditField>;
}
export async function readJiraCreation(
  context: JiraBoardActionContext,
  selection: { projectId?: string; issueTypeId?: string },
): Promise<Result<JiraCreationMetadata>> {
  const projects = await pages(
    context.http,
    `/rest/agile/1.0/board/${context.board.id}/project`,
    "values",
    ProjectSchema,
    100,
  );
  if (!projects.ok) return projects;
  if (!unique(projects.value.map((row) => String(row.id))))
    return failure("invalid_response", "Jira repeated project choices.");
  const options: JiraCreateOptions = {
    projects: projects.value.map((row) => ({
      id: String(row.id),
      label: `${row.key}: ${row.name}`,
    })),
    issueTypes: [],
    revision: null,
    available: false,
    message: "Choose a Jira project and issue type.",
  };
  const fields = new Map<string, JiraEditField>();
  if (!selection.projectId) return { ok: true, value: { options, fields } };
  if (!options.projects.some((row) => row.id === selection.projectId))
    return failure("invalid_target", "Choose a project supplied by this Jira board.");
  const base = `/rest/api/3/issue/createmeta/${encodeURIComponent(selection.projectId)}/issuetypes`;
  const types = await pages(context.http, base, "issueTypes", TypeSchema, 100);
  if (!types.ok) return types;
  if (!unique(types.value.map((row) => row.id)))
    return failure("invalid_response", "Jira repeated issue-type choices.");
  options.issueTypes = types.value
    .filter((row) => !row.subtask)
    .map((row) => ({ id: row.id, label: row.name }));
  if (!selection.issueTypeId) return { ok: true, value: { options, fields } };
  if (!options.issueTypes.some((row) => row.id === selection.issueTypeId))
    return failure("invalid_target", "Choose an available non-subtask issue type.");
  const metadata = await pages(
    context.http,
    base + "/" + encodeURIComponent(selection.issueTypeId),
    "fields",
    FieldSchema,
    500,
  );
  if (!metadata.ok) return metadata;
  for (const field of metadata.value) {
    if (fields.has(field.fieldId))
      return failure("invalid_response", "Jira repeated a creation field.");
    fields.set(field.fieldId, field);
  }
  const supplied = new Set(["project", "issuetype", "summary", "description"]);
  const blockers = metadata.value.filter(
    (field) => field.required && !field.hasDefaultValue && !supplied.has(field.fieldId),
  );
  options.message = unavailableReason(fields.get("summary"), blockers);
  options.available = options.message === null;
  options.revision = createHash("sha256")
    .update(
      JSON.stringify([
        context.board.id,
        selection.projectId,
        selection.issueTypeId,
        projects.value,
        types.value,
        metadata.value,
      ]),
    )
    .digest("hex");
  return { ok: true, value: { options, fields } };
}
