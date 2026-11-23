import { createHash } from "node:crypto";
import { z } from "zod";
import { failure, type EditableBoard, type Result } from "@getpaseo/plugin/otto/kanban";
import type { AtlassianHttp } from "../../../../services/otto/atlassian/http.js";
import { JiraIssueSchema, type JiraConfiguration, type JiraIssue } from "./schemas.js";
import {
  JiraEditFieldSchema,
  jiraFieldPlan,
  jiraFieldValue,
  type JiraFieldPlan,
} from "./fields.js";

const EditSchema = z.object({ fields: z.record(z.string(), JiraEditFieldSchema) });
const TransitionSchema = z.object({
  transitions: z
    .array(
      z.object({
        id: z.string(),
        to: z.object({ id: z.union([z.string(), z.number()]) }),
        fields: z.record(z.string(), JiraEditFieldSchema).optional(),
      }),
    )
    .max(500),
});
const PeopleSchema = z.array(z.object({ accountId: z.string(), displayName: z.string() })).max(100);
export interface JiraMutationContext {
  http: AtlassianHttp;
  configuration: JiraConfiguration;
  issue: JiraIssue;
  plans: Map<string, JiraFieldPlan>;
  transitions: Map<string, string>;
}
async function readEditMetadata(
  http: AtlassianHttp,
  key: string,
): Promise<Result<z.infer<typeof EditSchema>>> {
  const response = await http.read(`/rest/api/3/issue/${key}/editmeta`);
  // Reading an issue does not imply permission to edit it. A denied edit
  // screen removes those actions; it does not hide the readable issue.
  if (!response.ok)
    return response.error.code === "access_denied" ? { ok: true, value: { fields: {} } } : response;
  const parsed = EditSchema.safeParse(response.value);
  if (!parsed.success || Object.keys(parsed.data.fields).length > 500)
    return failure("invalid_response", "Jira returned incomplete or oversized editing metadata.");
  return { ok: true, value: parsed.data };
}
async function readTransitions(
  http: AtlassianHttp,
  key: string,
): Promise<Result<z.infer<typeof TransitionSchema>>> {
  const response = await http.read(
    `/rest/api/3/issue/${key}/transitions?expand=transitions.fields`,
  );
  if (!response.ok)
    return response.error.code === "access_denied"
      ? { ok: true, value: { transitions: [] } }
      : response;
  const parsed = TransitionSchema.safeParse(response.value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : failure("invalid_response", "Jira returned invalid workflow transitions.");
}
const observedFields = {
  summary: { name: "Title", schema: { type: "string" } },
  description: { name: "Description", schema: { type: "string" } },
  assignee: { name: "Assignee", schema: { type: "user" } },
  labels: { name: "Labels", schema: { type: "array", items: "string" } },
  priority: { name: "Priority", schema: { type: "option" } },
  duedate: { name: "Due date", schema: { type: "date" } },
};
async function people(
  http: AtlassianHttp,
  issueKey: string,
): Promise<Result<{ id: string; label: string }[]>> {
  const rows: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset <= 5000; offset += 100) {
    const query = new URLSearchParams({ issueKey, startAt: String(offset), maxResults: "100" });
    const result = await http.read(`/rest/api/3/user/assignable/search?${query}`);
    if (!result.ok) return result;
    const parsed = PeopleSchema.safeParse(result.value);
    if (!parsed.success)
      return failure("invalid_response", "Jira returned invalid assignable people.");
    for (const person of parsed.data) {
      if (seen.has(person.accountId))
        return failure("invalid_response", "Jira repeated its assignable-person page.");
      seen.add(person.accountId);
      rows.push({ id: person.accountId, label: person.displayName });
    }
    if (rows.length > 5000)
      return failure("read_limit", "This issue exceeds Otto's 5,000-person selection limit.");
    if (parsed.data.length < 100) return { ok: true, value: rows };
  }
  return failure("read_limit", "This issue exceeds Otto's assignable-person page limit.");
}
function allowedTransitions(
  config: JiraConfiguration,
  transitions: z.infer<typeof TransitionSchema>["transitions"],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const column of config.columnConfig.columns) {
    const statuses = new Set(column.statuses.map((status) => String(status.id)));
    const available = transitions.filter(
      (transition) =>
        statuses.has(String(transition.to.id)) &&
        !Object.values(transition.fields ?? {}).some(
          (field) => field.required && !field.hasDefaultValue,
        ),
    );
    // A column is not enough to disambiguate multiple workflow actions. Do not
    // silently choose a transition or invent values for a required screen.
    if (available.length === 1) result.set(column.name, available[0]!.id);
  }
  return result;
}
function display(
  value: ReturnType<typeof jiraFieldValue> & { ok: true },
  plan: JiraFieldPlan,
): string {
  const field = value.value;
  if (field.kind === "clear") return "";
  if ("value" in field) return String(field.value);
  const names = new Map(plan.definition.choices.map((choice) => [choice.id, choice.label]));
  if (field.kind === "choice") return names.get(field.id) ?? field.id;
  return field.ids.map((id) => names.get(id) ?? id).join(", ");
}
export async function readJiraCard(input: {
  http: AtlassianHttp;
  board: EditableBoard["board"];
  configuration: JiraConfiguration;
  cardId: string;
}): Promise<Result<{ snapshot: EditableBoard; context: JiraMutationContext }>> {
  if (!input.board.cards.some((card) => card.id === input.cardId))
    return failure("not_found", "This issue is no longer on the configured board.");
  const key = encodeURIComponent(input.cardId);
  const edit = await readEditMetadata(input.http, key);
  if (!edit.ok) return edit;
  const needsPeople = Object.values(edit.value.fields).some(
    (field) => field.schema?.type === "user" || field.schema?.items === "user",
  );
  const options = needsPeople
    ? await people(input.http, input.cardId)
    : { ok: true as const, value: [] };
  if (!options.ok && options.error.code !== "access_denied") return options;
  const transitions = await readTransitions(input.http, key);
  if (!transitions.ok) return transitions;
  const query = new URLSearchParams({
    fields: [
      ...new Set([
        "summary",
        "description",
        "updated",
        "status",
        "assignee",
        ...Object.keys(observedFields),
        ...Object.keys(edit.value.fields),
      ]),
    ].join(","),
  });
  const response = await input.http.read(`/rest/api/3/issue/${key}?${query}`);
  if (!response.ok) return response;
  const issue = JiraIssueSchema.safeParse(response.value);
  if (!issue.success || issue.data.key !== input.cardId)
    return failure("invalid_response", "Jira returned a different or invalid issue.");
  const plans = new Map(
    Object.entries({ ...observedFields, ...edit.value.fields }).map(([id, field]) => [
      id,
      jiraFieldPlan(id, field, options.ok ? options.value : []),
    ]),
  );
  const fields: EditableBoard["cardFields"][string] = [];
  for (const [id, plan] of plans) {
    const value = jiraFieldValue(plan, issue.data.fields[id]);
    if (!value.ok) return value;
    fields.push({
      fieldId: id,
      editable: plan.writable,
      display: display(value, plan),
      value: plan.route === "readonly" ? null : value.value,
    });
  }
  const moves = allowedTransitions(input.configuration, transitions.value.transitions);
  const revision = createHash("sha256")
    .update(JSON.stringify([issue.data.id, issue.data.fields]))
    .digest("hex");
  return {
    ok: true,
    value: {
      snapshot: {
        board: {
          ...input.board,
          capabilities: {
            ...input.board.capabilities,
            edit: fields.some((field) => field.editable),
            move: moves.size > 0,
            remove: false,
          },
        },
        fields: [...plans.values()].map((plan) => plan.definition),
        cardFields: { [input.cardId]: fields },
        cardRevisions: { [input.cardId]: revision },
        allowedMoves: { [input.cardId]: [...moves.keys()] },
      },
      context: {
        http: input.http,
        configuration: input.configuration,
        issue: issue.data,
        plans,
        transitions: moves,
      },
    },
  };
}
