import { z } from "zod";
import {
  failure,
  type BoardFieldValue,
  type EditableBoard,
  type Result,
} from "@getpaseo/plugin/otto/kanban";
import { jiraDescription, jiraDocument } from "./adf.js";

export const JiraEditFieldSchema = z.object({
  name: z.string(),
  required: z.boolean().optional(),
  operations: z.array(z.string()).optional(),
  schema: z
    .object({
      type: z.string(),
      items: z.string().optional(),
      system: z.string().optional(),
      custom: z.string().optional(),
    })
    .optional(),
  allowedValues: z.array(z.unknown()).optional(),
  hasDefaultValue: z.boolean().optional(),
});
export type JiraEditField = z.infer<typeof JiraEditFieldSchema>;
const OptionSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  accountId: z.string().optional(),
  name: z.string().optional(),
  value: z.string().optional(),
  displayName: z.string().optional(),
});
export type JiraFieldRoute =
  | "text"
  | "description"
  | "number"
  | "date"
  | "choice"
  | "choices"
  | "user"
  | "users"
  | "labels"
  | "readonly";
export interface JiraFieldPlan {
  definition: EditableBoard["fields"][number];
  route: JiraFieldRoute;
  writable: boolean;
}
function fieldRouteFor(id: string, field: JiraEditField): JiraFieldRoute {
  if (id === "description") return "description";
  if (id === "labels") return "labels";
  if (id === "duedate") return "date";
  if (field.schema?.type === "number") return "number";
  if (field.schema?.type === "date") return "date";
  if (field.schema?.type === "user") return "user";
  if (field.schema?.type === "array") {
    if (field.schema.items === "string") return "labels";
    if (field.schema.items === "user") return "users";
    return field.allowedValues?.length ? "choices" : "readonly";
  }
  if (field.allowedValues?.length) return "choice";
  if (field.schema?.type === "string") return "text";
  return "readonly";
}
export function jiraFieldPlan(
  id: string,
  field: JiraEditField,
  people: { id: string; label: string }[],
): JiraFieldPlan {
  const via = fieldRouteFor(id, field);
  const options = (field.allowedValues ?? []).flatMap((value) => {
    if (typeof value === "string" || typeof value === "number")
      return [{ id: String(value), label: String(value) }];
    const parsed = OptionSchema.safeParse(value);
    if (!parsed.success) return [];
    const row = parsed.data;
    const identity = row.accountId ?? row.id;
    if (identity === undefined) return [];
    return [
      { id: String(identity), label: row.displayName ?? row.name ?? row.value ?? String(identity) },
    ];
  });
  const kinds: Record<JiraFieldRoute, string> = {
    text: "text",
    description: "text",
    labels: "text",
    number: "number",
    date: "date",
    choice: "choice",
    choices: "choices",
    user: "choice",
    users: "people",
    readonly: "readonly",
  };
  const choices = (via === "user" || via === "users") && !options.length ? people : options;
  return {
    definition: {
      id,
      name: field.name,
      kind: kinds[via],
      choices,
      required: field.required === true,
    },
    route: via,
    writable:
      via !== "readonly" &&
      field.operations?.includes("set") === true &&
      ((via !== "user" && via !== "users") || options.length > 0 || people.length > 0),
  };
}
function ids(value: unknown, user = false): Result<string[]> {
  const rows = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  for (const row of rows) {
    const parsed = OptionSchema.safeParse(row);
    if (!parsed.success)
      return failure("invalid_response", "Jira returned an invalid selected field value.");
    const key = user ? parsed.data.accountId : parsed.data.id;
    if (key === undefined)
      return failure("invalid_response", "Jira omitted a selected field identity.");
    result.push(String(key));
  }
  return { ok: true, value: result };
}
function readSelected(route: JiraFieldRoute, value: unknown): Result<BoardFieldValue> {
  const selected = ids(value, route === "user" || route === "users");
  if (!selected.ok) return selected;
  if (route === "user" || route === "choice")
    return {
      ok: true,
      value: selected.value[0] ? { kind: "choice", id: selected.value[0] } : { kind: "clear" },
    };
  return {
    ok: true,
    value: { kind: route === "users" ? "people" : "choices", ids: selected.value },
  };
}
function readOnlyDisplay(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  const option = OptionSchema.safeParse(value);
  if (!option.success) return "Unsupported field type";
  return (
    option.data.displayName ?? option.data.name ?? option.data.value ?? "Unsupported field type"
  );
}
export function jiraFieldValue(plan: JiraFieldPlan, value: unknown): Result<BoardFieldValue> {
  if (value === undefined || value === null) return { ok: true, value: { kind: "clear" } };
  switch (plan.route) {
    case "description": {
      const body = jiraDescription(value);
      return body.ok ? { ok: true, value: { kind: "text", value: body.value } } : body;
    }
    case "labels":
      return Array.isArray(value) && value.every((row) => typeof row === "string")
        ? { ok: true, value: { kind: "text", value: value.join(", ") } }
        : failure("invalid_response", "Jira returned invalid labels.");
    case "text":
    case "date":
      return typeof value === "string"
        ? { ok: true, value: { kind: plan.route === "date" ? "date" : "text", value } }
        : failure("invalid_response", "Jira returned an invalid text/date field.");
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { ok: true, value: { kind: "number", value } }
        : failure("invalid_response", "Jira returned an invalid number field.");
    case "user":
    case "choice":
    case "users":
    case "choices":
      return readSelected(plan.route, value);
    default:
      return { ok: true, value: { kind: "text", value: readOnlyDisplay(value) } };
  }
}
function clearValue(plan: JiraFieldPlan): Result<unknown> {
  if (plan.definition.required) return failure("invalid_target", "This Jira field is required.");
  return {
    ok: true,
    value:
      plan.route === "labels" || plan.route === "choices" || plan.route === "users" ? [] : null,
  };
}
const selections = new Set<JiraFieldRoute>(["user", "users", "choice", "choices"]);
function selectionValue(route: JiraFieldRoute, value: BoardFieldValue): Result<unknown> {
  if (route === "user" && value.kind === "choice")
    return { ok: true, value: { accountId: value.id } };
  if (route === "choice" && value.kind === "choice") return { ok: true, value: { id: value.id } };
  if (route === "users" && value.kind === "people")
    return { ok: true, value: value.ids.map((id) => ({ accountId: id })) };
  if (route === "choices" && value.kind === "choices")
    return { ok: true, value: value.ids.map((id) => ({ id })) };
  return failure("invalid_target", "Choose a supported option or assignable person.");
}
export function jiraWriteValue(plan: JiraFieldPlan, value: BoardFieldValue): Result<unknown> {
  if (!plan.writable || plan.route === "readonly")
    return failure("unsupported", "This Jira field is read-only.");
  if (value.kind === "clear") return clearValue(plan);
  if (selections.has(plan.route)) return selectionValue(plan.route, value);
  switch (plan.route) {
    case "description":
      return value.kind === "text"
        ? { ok: true, value: jiraDocument(value.value) }
        : failure("invalid_target", "Enter a description.");
    case "text":
    case "date":
    case "number":
      return value.kind === plan.definition.kind && "value" in value
        ? { ok: true, value: value.value }
        : failure("invalid_target", "Enter a supported Jira field value.");
    case "labels": {
      if (value.kind !== "text") return failure("invalid_target", "Enter comma-separated labels.");
      const labels = [
        ...new Set(
          value.value
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean),
        ),
      ];
      if (
        plan.definition.choices.length &&
        !labels.every((label) => plan.definition.choices.some((choice) => choice.id === label))
      )
        return failure("invalid_target", "Choose one of the allowed values for this Jira field.");
      return labels.length <= 100 && labels.every((label) => !/\s/.test(label))
        ? { ok: true, value: labels }
        : failure("invalid_target", "Use at most 100 labels without spaces, separated by commas.");
    }
    default:
      return failure("unsupported", "This Jira field is read-only.");
  }
}
