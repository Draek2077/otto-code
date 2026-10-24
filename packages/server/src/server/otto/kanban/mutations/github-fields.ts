import type { BoardFieldValue, EditableBoard } from "@getpaseo/plugin/otto/kanban";
import type { GitHubContent, GitHubField, GitHubValue, RepoChoices } from "./github-schemas.js";

export type FieldRoute =
  | "title"
  | "body"
  | "assigneeIds"
  | "labelIds"
  | "project"
  | "iteration"
  | "readonly";
export const BODY_FIELD = "otto.body";
export function fieldDefinition(
  field: GitHubField,
  choices: RepoChoices,
): EditableBoard["fields"][number] {
  let kind = "readonly";
  let options: { id: string; label: string }[] = [];
  switch (field.dataType) {
    case "TITLE":
    case "TEXT":
      kind = "text";
      break;
    case "NUMBER":
      kind = "number";
      break;
    case "DATE":
      kind = "date";
      break;
    case "SINGLE_SELECT":
      kind = "choice";
      options = (field.options ?? []).map((row) => ({ id: row.id, label: row.name }));
      break;
    case "MULTI_SELECT":
      kind = "choices";
      options = (field.multiSelectOptions ?? []).map((row) => ({ id: row.id, label: row.name }));
      break;
    case "ITERATION":
      kind = "choice";
      options = [
        ...(field.configuration?.iterations ?? []),
        ...(field.configuration?.completedIterations ?? []),
      ].map((row) => ({ id: row.id, label: row.title }));
      break;
    case "ASSIGNEES":
      kind = "people";
      options = choices.people;
      break;
    case "LABELS":
      kind = "choices";
      options = choices.labels;
      break;
    default:
      break;
  }
  return { id: field.id, name: field.name, kind, choices: options };
}
export function fieldRoute(field: GitHubField): FieldRoute {
  switch (field.dataType) {
    case "TITLE":
      return "title";
    case "ASSIGNEES":
      return "assigneeIds";
    case "LABELS":
      return "labelIds";
    case "ITERATION":
      return "iteration";
    case "TEXT":
    case "NUMBER":
    case "DATE":
    case "SINGLE_SELECT":
    case "MULTI_SELECT":
      return "project";
    default:
      return "readonly";
  }
}
function customValue(raw: GitHubValue | undefined): BoardFieldValue {
  if (!raw) return { kind: "clear" };
  switch (raw.__typename) {
    case "ProjectV2ItemFieldTextValue":
      return raw.text === null || raw.text === undefined
        ? { kind: "clear" }
        : { kind: "text", value: raw.text };
    case "ProjectV2ItemFieldNumberValue":
      return raw.number === null || raw.number === undefined
        ? { kind: "clear" }
        : { kind: "number", value: raw.number };
    case "ProjectV2ItemFieldDateValue":
      return raw.date ? { kind: "date", value: raw.date } : { kind: "clear" };
    case "ProjectV2ItemFieldSingleSelectValue":
      return raw.optionId ? { kind: "choice", id: raw.optionId } : { kind: "clear" };
    case "ProjectV2ItemFieldMultiSelectValue":
      return { kind: "choices", ids: (raw.options ?? []).map((row) => row.id) };
    case "ProjectV2ItemFieldIterationValue":
      return raw.iterationId ? { kind: "choice", id: raw.iterationId } : { kind: "clear" };
    default:
      return { kind: "clear" };
  }
}
function valueFor(
  route: FieldRoute,
  content: GitHubContent,
  raw: GitHubValue | undefined,
): BoardFieldValue {
  if (route === "title" || route === "body") return { kind: "text", value: content[route] };
  if (route === "assigneeIds")
    return { kind: "people", ids: content.assignees.nodes.map((person) => person.id) };
  if (route === "labelIds")
    return {
      kind: "choices",
      ids: "labels" in content ? content.labels.nodes.map((label) => label.id) : [],
    };
  return customValue(raw);
}
function display(value: BoardFieldValue, field: EditableBoard["fields"][number]): string {
  if (value.kind === "clear") return "";
  if ("value" in value) return String(value.value);
  const options = new Map(field.choices.map((row) => [row.id, row.label]));
  if (value.kind === "choice") return options.get(value.id) ?? value.id;
  return value.ids.map((entry) => options.get(entry) ?? entry).join(", ");
}
export function cardField(input: {
  definition: EditableBoard["fields"][number];
  route: FieldRoute;
  content: GitHubContent;
  value: GitHubValue | undefined;
  canUpdateProject: boolean;
}): EditableBoard["cardFields"][string][number] {
  const { route, content } = input;
  const canUpdateContent =
    content.__typename === "DraftIssue" ? input.canUpdateProject : content.viewerCanUpdate;
  const value = valueFor(route, content, input.value);
  let editable = input.canUpdateProject && route !== "readonly";
  if (route === "title" || route === "body" || route === "assigneeIds" || route === "labelIds")
    editable = canUpdateContent;
  if (route === "labelIds" && content.__typename === "DraftIssue") editable = false;
  return {
    fieldId: input.definition.id,
    editable,
    display: display(value, input.definition),
    value: route === "readonly" ? null : value,
  };
}
