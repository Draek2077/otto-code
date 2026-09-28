import type {
  KanbanCardFieldValue,
  KanbanField,
  KanbanFieldOption,
  KanbanFieldValueInput,
} from "@otto-code/protocol/kanban";

/**
 * Maps GitHub Projects v2 fields onto Otto's provider-neutral card fields.
 *
 * The central observation is that a project's own `fields` list already *is* the
 * field schema: "Priority" and "Due date" are ordinary user-created
 * SINGLE_SELECT and DATE fields, and "Title", "Assignees" and "Labels" are
 * built-ins that appear in the same list. So there is nothing to hardcode - a
 * field's `dataType` decides both the editor it needs and how a write reaches it.
 *
 * Writes split three ways, and the split is not cosmetic:
 *
 *  - `ProjectV2CustomFieldType` (TEXT, NUMBER, DATE, SINGLE_SELECT,
 *    MULTI_SELECT, ITERATION) is exactly the set `updateProjectV2ItemFieldValue`
 *    accepts, and each one keys a different member of `ProjectV2FieldValue`.
 *  - TITLE, ASSIGNEES and LABELS live on the underlying work item, so they go
 *    through `updateIssue` / `updatePullRequest` / `updateProjectV2DraftIssue`.
 *  - Everything else GitHub computes (REPOSITORY, MILESTONE, LINKED_PULL_REQUESTS,
 *    REVIEWERS, TRACKS, CREATED, ...) is read-only, and says so rather than
 *    disappearing.
 */

/**
 * The card description, which is the one field with no GitHub field definition
 * behind it: an issue body is not a project field. Prefixed so it can never
 * collide with a GraphQL node id, which is what every other field id is.
 */
export const BODY_FIELD_ID = "otto.body";

/** How a write on one field reaches GitHub. */
export type GitHubFieldWrite =
  | { via: "projectText" }
  | { via: "projectNumber" }
  | { via: "projectDate" }
  | { via: "projectSingleSelect" }
  | { via: "projectMultiSelect" }
  | { via: "projectIteration" }
  | { via: "contentTitle" }
  | { via: "contentBody" }
  | { via: "contentAssignees" }
  | { via: "contentLabels" }
  | { via: "readOnly"; reason: string };

/** A board field plus the route a write on it takes. */
export interface GitHubBoardField {
  field: KanbanField;
  write: GitHubFieldWrite;
}

/** One repository's assignable people and labels, for field options. */
export interface GitHubRepoOptions {
  assignableUsers: KanbanFieldOption[];
  labels: KanbanFieldOption[];
}

export interface RawFieldDefinition {
  __typename: string;
  id: string;
  name: string;
  dataType: string;
  /** Single-select choices. */
  options?: Array<{ id: string; name: string }>;
  /** Multi-select choices live under their own name on the GitHub type. */
  multiSelectOptions?: Array<{ id: string; name: string }>;
  configuration?: {
    iterations?: Array<{ id: string; title: string }>;
    completedIterations?: Array<{ id: string; title: string }>;
  };
}

export interface RawFieldValue {
  __typename: string;
  field?: { id?: string };
  text?: string | null;
  number?: number | null;
  date?: string | null;
  optionId?: string | null;
  name?: string | null;
  options?: Array<{ id: string; name: string }> | null;
  iterationId?: string | null;
  title?: string | null;
}

/** The parts of a card's content that carry field values. */
export interface GitHubCardContent {
  typename: "DraftIssue" | "Issue" | "PullRequest";
  /** The work item's own node id, which content mutations address. */
  contentId: string;
  title: string;
  bodyText: string;
  assignees: KanbanFieldOption[];
  labels: KanbanFieldOption[];
  /** Absent on a draft issue, which belongs to no repository. */
  repositoryId?: string;
}

/**
 * `dataType` to editor kind. ITERATION presents as a single select because that
 * is what choosing an iteration is; the write still sends an `iterationId`,
 * which is why the write route is tracked separately from the kind.
 */
const CUSTOM_FIELD_KINDS: Record<string, { kind: string; write: GitHubFieldWrite }> = {
  TEXT: { kind: "text", write: { via: "projectText" } },
  NUMBER: { kind: "number", write: { via: "projectNumber" } },
  DATE: { kind: "date", write: { via: "projectDate" } },
  SINGLE_SELECT: { kind: "singleSelect", write: { via: "projectSingleSelect" } },
  MULTI_SELECT: { kind: "multiSelect", write: { via: "projectMultiSelect" } },
  ITERATION: { kind: "singleSelect", write: { via: "projectIteration" } },
};

/**
 * Fields GitHub derives and will not accept a write for. Naming them beats a
 * silent fallback: the UI shows the value with a reason instead of an editor.
 */
const DERIVED_FIELD_REASONS: Record<string, string> = {
  REPOSITORY: "GitHub sets a card's repository when the work item is added to the board.",
  MILESTONE: "Milestones are set on the issue in GitHub, not on the project board.",
  LINKED_PULL_REQUESTS: "GitHub derives linked pull requests from the issue's own links.",
  REVIEWERS: "Reviewers are set on the pull request in GitHub.",
  TRACKS: "GitHub derives tracked work from the issue's task list.",
  TRACKED_BY: "GitHub derives this from the issue that tracks this one.",
  SUB_ISSUES_PROGRESS: "GitHub computes sub-issue progress from the issue's sub-issues.",
  ISSUE_TYPE: "Issue types are set on the issue in GitHub.",
  PARENT_ISSUE: "GitHub derives the parent from the issue hierarchy.",
  CREATED: "GitHub records when the card was created.",
  UPDATED: "GitHub records when the card last changed.",
  CLOSED: "GitHub records when the work item was closed.",
};

const DRAFT_LABELS_REASON =
  "A draft issue has no repository, so it cannot carry labels until it is converted to an issue.";

/**
 * Builds the board's field list.
 *
 * `statusFieldId` is excluded: the status field is already the board's columns,
 * and offering it a second time as an ordinary select would give a user two
 * different controls for the same value.
 */
export function buildBoardFields(input: {
  definitions: readonly RawFieldDefinition[];
  statusFieldId: string | null;
  /** Union across the board's repositories, for board-level option lists. */
  allRepoOptions: GitHubRepoOptions;
}): GitHubBoardField[] {
  const fields: GitHubBoardField[] = [];
  for (const definition of input.definitions) {
    if (definition.id === input.statusFieldId) {
      continue;
    }
    const built = buildOneField(definition, input.allRepoOptions);
    if (built) {
      fields.push(built);
    }
  }
  // The description has no GitHub field definition, so it is appended rather
  // than mapped. It sits after Title, which is where a reader expects it.
  const titleIndex = fields.findIndex((entry) => entry.write.via === "contentTitle");
  const body: GitHubBoardField = {
    field: { id: BODY_FIELD_ID, name: "Description", kind: "richText", editable: true },
    write: { via: "contentBody" },
  };
  fields.splice(titleIndex >= 0 ? titleIndex + 1 : fields.length, 0, body);
  return fields;
}

function buildOneField(
  definition: RawFieldDefinition,
  allRepoOptions: GitHubRepoOptions,
): GitHubBoardField | null {
  const custom = CUSTOM_FIELD_KINDS[definition.dataType];
  if (custom) {
    const options = customFieldOptions(definition);
    return {
      field: {
        id: definition.id,
        name: definition.name,
        kind: custom.kind,
        editable: true,
        ...(options ? { options } : {}),
      },
      write: custom.write,
    };
  }
  if (definition.dataType === "TITLE") {
    return {
      field: { id: definition.id, name: definition.name, kind: "text", editable: true },
      write: { via: "contentTitle" },
    };
  }
  if (definition.dataType === "ASSIGNEES") {
    return {
      field: {
        id: definition.id,
        name: definition.name,
        kind: "users",
        editable: true,
        options: allRepoOptions.assignableUsers,
      },
      write: { via: "contentAssignees" },
    };
  }
  if (definition.dataType === "LABELS") {
    return {
      field: {
        id: definition.id,
        name: definition.name,
        kind: "labels",
        editable: true,
        options: allRepoOptions.labels,
      },
      write: { via: "contentLabels" },
    };
  }
  const reason =
    DERIVED_FIELD_REASONS[definition.dataType] ??
    `Otto cannot write GitHub's ${definition.dataType} fields.`;
  return {
    field: {
      id: definition.id,
      name: definition.name,
      kind: "text",
      editable: false,
      readOnlyReason: reason,
    },
    write: { via: "readOnly", reason },
  };
}

function customFieldOptions(definition: RawFieldDefinition): KanbanFieldOption[] | null {
  if (definition.dataType === "SINGLE_SELECT") {
    return (definition.options ?? []).map((option) => ({ id: option.id, name: option.name }));
  }
  if (definition.dataType === "MULTI_SELECT") {
    return (definition.multiSelectOptions ?? []).map((option) => ({
      id: option.id,
      name: option.name,
    }));
  }
  if (definition.dataType === "ITERATION") {
    // Completed iterations stay selectable: a card can legitimately still sit in
    // one, and hiding them would make its current value unreadable.
    const configuration = definition.configuration;
    return [
      ...(configuration?.iterations ?? []),
      ...(configuration?.completedIterations ?? []),
    ].map((iteration) => ({ id: iteration.id, name: iteration.title }));
  }
  return null;
}

/**
 * Builds one card's field values.
 *
 * Title, description, assignees and labels are read from the work item's own
 * content rather than from the project's value list, because content is where
 * they are authoritative and is already fetched for the card itself. Custom
 * fields are read from the value list, where an absent entry means "empty".
 */
export function buildCardFieldValues(input: {
  fields: readonly GitHubBoardField[];
  content: GitHubCardContent;
  values: readonly RawFieldValue[];
  /** Per-repository options, so a card offers only labels its own repo has. */
  repoOptions: GitHubRepoOptions | null;
}): KanbanCardFieldValue[] {
  const byFieldId = new Map<string, RawFieldValue>();
  for (const value of input.values) {
    const fieldId = value.field?.id;
    if (fieldId) {
      byFieldId.set(fieldId, value);
    }
  }
  const out: KanbanCardFieldValue[] = [];
  for (const entry of input.fields) {
    const built = buildOneValue(
      entry,
      input.content,
      byFieldId.get(entry.field.id),
      input.repoOptions,
    );
    if (built) {
      out.push(built);
    }
  }
  return out;
}

function buildOneValue(
  entry: GitHubBoardField,
  content: GitHubCardContent,
  raw: RawFieldValue | undefined,
  repoOptions: GitHubRepoOptions | null,
): KanbanCardFieldValue | null {
  const fieldId = entry.field.id;
  switch (entry.write.via) {
    case "contentTitle":
      return { fieldId, display: content.title, value: { kind: "text", text: content.title } };
    case "contentBody":
      return content.bodyText
        ? { fieldId, display: content.bodyText, value: { kind: "text", text: content.bodyText } }
        : { fieldId, display: "" };
    case "contentAssignees":
      return {
        fieldId,
        display: content.assignees.map((user) => user.name).join(", "),
        ...(content.assignees.length > 0
          ? { value: optionValue(content.assignees.map((user) => user.id)) }
          : {}),
        // A draft issue takes any user the credential can see, so the board-wide
        // union stands; an issue or PR is limited to its own repository.
        ...(repoOptions ? { options: repoOptions.assignableUsers } : {}),
      };
    case "contentLabels":
      if (content.typename === "DraftIssue") {
        return {
          fieldId,
          display: "",
          editable: false,
          readOnlyReason: DRAFT_LABELS_REASON,
          options: [],
        };
      }
      return {
        fieldId,
        display: content.labels.map((label) => label.name).join(", "),
        ...(content.labels.length > 0
          ? { value: optionValue(content.labels.map((label) => label.id)) }
          : {}),
        // A label id belongs to one repository, so offering the board-wide union
        // would let a reader pick a label this card cannot take.
        ...(repoOptions ? { options: repoOptions.labels } : {}),
      };
    case "readOnly":
      return { fieldId, display: displayOfRaw(raw) };
    default:
      return valueOfCustomField(fieldId, raw);
  }
}

function valueOfCustomField(fieldId: string, raw: RawFieldValue | undefined): KanbanCardFieldValue {
  if (!raw) {
    return { fieldId, display: "" };
  }
  switch (raw.__typename) {
    case "ProjectV2ItemFieldTextValue":
      return raw.text
        ? { fieldId, display: raw.text, value: { kind: "text", text: raw.text } }
        : { fieldId, display: "" };
    case "ProjectV2ItemFieldNumberValue":
      return typeof raw.number === "number"
        ? {
            fieldId,
            display: String(raw.number),
            value: { kind: "number", number: raw.number },
          }
        : { fieldId, display: "" };
    case "ProjectV2ItemFieldDateValue":
      return raw.date
        ? { fieldId, display: raw.date, value: { kind: "date", date: raw.date } }
        : { fieldId, display: "" };
    case "ProjectV2ItemFieldSingleSelectValue":
      return raw.optionId
        ? { fieldId, display: raw.name ?? "", value: optionValue([raw.optionId]) }
        : { fieldId, display: "" };
    case "ProjectV2ItemFieldMultiSelectValue": {
      const options = raw.options ?? [];
      return options.length > 0
        ? {
            fieldId,
            display: options.map((option) => option.name).join(", "),
            value: optionValue(options.map((option) => option.id)),
          }
        : { fieldId, display: "" };
    }
    case "ProjectV2ItemFieldIterationValue":
      return raw.iterationId
        ? { fieldId, display: raw.title ?? "", value: optionValue([raw.iterationId]) }
        : { fieldId, display: "" };
    default:
      return { fieldId, display: displayOfRaw(raw) };
  }
}

/** Best-effort text for a value arm this provider does not model. */
function displayOfRaw(raw: RawFieldValue | undefined): string {
  if (!raw) {
    return "";
  }
  if (typeof raw.text === "string") return raw.text;
  if (typeof raw.name === "string") return raw.name;
  if (typeof raw.title === "string") return raw.title;
  if (typeof raw.number === "number") return String(raw.number);
  if (typeof raw.date === "string") return raw.date;
  return "";
}

function optionValue(optionIds: string[]): KanbanFieldValueInput {
  return { kind: "options", optionIds };
}

/** The project-field value members `ProjectV2FieldValue` accepts. */
export type GitHubProjectValueKey =
  | "text"
  | "number"
  | "date"
  | "singleSelectOptionId"
  | "multiSelectOptionIds"
  | "iterationId";

/** What one field write resolves to, before it is sent. */
export type GitHubWritePlan =
  | { target: "projectField"; key: GitHubProjectValueKey; value: string | number | string[] }
  | { target: "clearProjectField" }
  | {
      target: "content";
      patch: { title?: string; body?: string; assigneeIds?: string[]; labelIds?: string[] };
    };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Translates a requested field value into the write GitHub will accept, or
 * throws with the reason it will not.
 *
 * Rejecting here rather than at the API keeps the error in Otto's own language:
 * GitHub answers a kind mismatch with a generic input error that names neither
 * the field nor what it wanted.
 */
export function planCardFieldWrite(
  entry: GitHubBoardField,
  value: KanbanFieldValueInput,
): GitHubWritePlan {
  if (entry.write.via === "readOnly") {
    throw new Error(`${entry.field.name} cannot be changed from Otto. ${entry.write.reason}`);
  }
  return entry.write.via.startsWith("content")
    ? planContentWrite(entry, value)
    : planProjectFieldWrite(entry, value);
}

/** Title, description, assignees and labels, which live on the work item. */
function planContentWrite(entry: GitHubBoardField, value: KanbanFieldValueInput): GitHubWritePlan {
  const name = entry.field.name;
  const clearing = value.kind === "clear";
  switch (entry.write.via) {
    case "contentTitle": {
      if (clearing) {
        throw new Error("A card must have a title.");
      }
      const title = expectText(value, name).trim();
      if (!title) {
        throw new Error("A card must have a title.");
      }
      return { target: "content", patch: { title } };
    }
    case "contentBody":
      return { target: "content", patch: { body: clearing ? "" : expectText(value, name) } };
    case "contentAssignees":
      return { target: "content", patch: { assigneeIds: optionIdsOrEmpty(value, name) } };
    default:
      return { target: "content", patch: { labelIds: optionIdsOrEmpty(value, name) } };
  }
}

/** The six `ProjectV2CustomFieldType` kinds, which live on the project item. */
function planProjectFieldWrite(
  entry: GitHubBoardField,
  value: KanbanFieldValueInput,
): GitHubWritePlan {
  const name = entry.field.name;
  const clearing = value.kind === "clear";
  switch (entry.write.via) {
    case "projectText":
      if (clearing) return { target: "clearProjectField" };
      return { target: "projectField", key: "text", value: expectText(value, name) };
    case "projectNumber":
      if (clearing) return { target: "clearProjectField" };
      if (value.kind !== "number") {
        throw new Error(`${name} takes a number.`);
      }
      return { target: "projectField", key: "number", value: value.number };
    case "projectDate": {
      if (clearing) return { target: "clearProjectField" };
      if (value.kind !== "date") {
        throw new Error(`${name} takes a date.`);
      }
      if (!ISO_DATE.test(value.date)) {
        throw new Error(`${name} takes a date as YYYY-MM-DD, not "${value.date}".`);
      }
      return { target: "projectField", key: "date", value: value.date };
    }
    case "projectSingleSelect": {
      const ids = optionIdsOrEmpty(value, name);
      if (ids.length === 0) return { target: "clearProjectField" };
      return { target: "projectField", key: "singleSelectOptionId", value: requireOne(ids, name) };
    }
    case "projectMultiSelect": {
      const ids = optionIdsOrEmpty(value, name);
      if (ids.length === 0) return { target: "clearProjectField" };
      return { target: "projectField", key: "multiSelectOptionIds", value: ids };
    }
    default: {
      const ids = optionIdsOrEmpty(value, name);
      if (ids.length === 0) return { target: "clearProjectField" };
      return { target: "projectField", key: "iterationId", value: requireOne(ids, name) };
    }
  }
}

function expectText(value: KanbanFieldValueInput, name: string): string {
  if (value.kind !== "text") {
    throw new Error(`${name} takes text.`);
  }
  return value.text;
}

function optionIdsOrEmpty(value: KanbanFieldValueInput, name: string): string[] {
  if (value.kind === "clear") {
    return [];
  }
  if (value.kind !== "options") {
    throw new Error(`${name} takes a choice from its options.`);
  }
  return value.optionIds;
}

function requireOne(ids: string[], name: string): string {
  if (ids.length !== 1) {
    throw new Error(`${name} takes one option, not ${ids.length}.`);
  }
  return ids[0] as string;
}

/** One GitHub label as a field option, colour included when it parses. */
export function toLabelOption(label: {
  id: string;
  name: string;
  color?: string | null;
}): KanbanFieldOption {
  const color = labelColor(label.color);
  return color ? { id: label.id, name: label.name, color } : { id: label.id, name: label.name };
}

/**
 * Reads a `#rrggbb` from GitHub's bare hex label colour.
 *
 * Only labels get a colour. GitHub's single-select colours are palette *names*
 * (GREEN, PURPLE), and translating those into hex would be Otto inventing a
 * palette, so select options carry none and the client styles them from the
 * active theme instead.
 */
export function labelColor(raw: string | null | undefined): string | undefined {
  return raw && /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw.toLowerCase()}` : undefined;
}
