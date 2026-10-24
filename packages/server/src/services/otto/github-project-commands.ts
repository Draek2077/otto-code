/** Known Projects writes through the existing gh runner/account/host policy. */
import { z } from "zod";
import { BoardFieldValueSchema } from "@getpaseo/plugin/otto/kanban";

const id = z.string().min(1).max(512);
const item = { projectId: id, itemId: id };
export const GitHubBoardCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("create"),
      projectId: id,
      title: z.string().min(1).max(1024),
      body: z.string().max(65_536),
    })
    .strict(),
  z.object({ kind: z.literal("link"), projectId: id, contentId: id }).strict(),
  z.object({ kind: z.literal("remove"), ...item }).strict(),
  z.object({ kind: z.literal("iteration"), ...item, fieldId: id, iterationId: id }).strict(),
  z
    .object({ kind: z.literal("field"), ...item, fieldId: id, value: BoardFieldValueSchema })
    .strict(),
  z
    .object({
      kind: z.literal("content"),
      contentKind: z.enum(["DraftIssue", "Issue", "PullRequest"]),
      contentId: id,
      field: z.enum(["title", "body", "assigneeIds", "labelIds"]),
      value: z.union([z.string().max(65_536), z.array(id).max(100)]),
    })
    .strict(),
]);
export type GitHubBoardCommand = z.infer<typeof GitHubBoardCommandSchema>;
interface Plan {
  mutation: string;
  inputType: string;
  payload: string;
  input: Record<string, string | string[] | null | Record<string, string | string[]>>;
}

function contentPlan(command: Extract<GitHubBoardCommand, { kind: "content" }>): Plan {
  if (command.contentKind === "DraftIssue" && command.field === "labelIds")
    throw new Error("Drafts do not have repository labels");
  const array = command.field === "assigneeIds" || command.field === "labelIds";
  if (array !== Array.isArray(command.value)) throw new Error("Invalid content field value");
  if (command.field === "title" && (typeof command.value !== "string" || !command.value.trim()))
    throw new Error("Enter a title");
  const types = {
    DraftIssue: {
      mutation: "updateProjectV2DraftIssue",
      inputType: "UpdateProjectV2DraftIssueInput",
      payload: "draftIssue",
      idKey: "draftIssueId",
    },
    Issue: {
      mutation: "updateIssue",
      inputType: "UpdateIssueInput",
      payload: "issue",
      idKey: "id",
    },
    PullRequest: {
      mutation: "updatePullRequest",
      inputType: "UpdatePullRequestInput",
      payload: "pullRequest",
      idKey: "pullRequestId",
    },
  };
  const type = types[command.contentKind];
  return { ...type, input: { [type.idKey]: command.contentId, [command.field]: command.value } };
}
function fieldPlan(command: Extract<GitHubBoardCommand, { kind: "field" }>): Plan {
  const input = { projectId: command.projectId, itemId: command.itemId, fieldId: command.fieldId };
  if (command.value.kind === "clear")
    return {
      mutation: "clearProjectV2ItemFieldValue",
      inputType: "ClearProjectV2ItemFieldValueInput",
      payload: "projectV2Item",
      input,
    };
  const value = command.value;
  let entry: Record<string, string | string[]>;
  switch (value.kind) {
    case "text":
      entry = { text: value.value };
      break;
    case "date":
      entry = { date: value.value };
      break;
    case "choice":
      entry = { singleSelectOptionId: value.id };
      break;
    case "choices":
      entry = { multiSelectOptionIds: value.ids };
      break;
    default:
      throw new Error("This project field kind requires another mutation");
  }
  return {
    mutation: "updateProjectV2ItemFieldValue",
    inputType: "UpdateProjectV2ItemFieldValueInput",
    payload: "projectV2Item",
    input: { ...input, value: entry },
  };
}
function plan(command: GitHubBoardCommand): Plan {
  switch (command.kind) {
    case "create":
      return {
        mutation: "addProjectV2DraftIssue",
        inputType: "AddProjectV2DraftIssueInput",
        payload: "projectItem",
        input: { projectId: command.projectId, title: command.title, body: command.body },
      };
    case "link":
      return {
        mutation: "addProjectV2ItemById",
        inputType: "AddProjectV2ItemByIdInput",
        payload: "item",
        input: { projectId: command.projectId, contentId: command.contentId },
      };
    case "remove":
      return {
        mutation: "deleteProjectV2Item",
        inputType: "DeleteProjectV2ItemInput",
        payload: "deletedItemId",
        input: { projectId: command.projectId, itemId: command.itemId },
      };
    case "iteration":
      return {
        mutation: "updateProjectV2ItemFieldValue",
        inputType: "UpdateProjectV2ItemFieldValueInput",
        payload: "projectV2Item",
        input: {
          projectId: command.projectId,
          itemId: command.itemId,
          fieldId: command.fieldId,
          value: { iterationId: command.iterationId },
        },
      };
    case "field":
      return fieldPlan(command);
    case "content":
      return contentPlan(command);
  }
}
function append(args: string[], key: string, value: Plan["input"][string]): void {
  if (Array.isArray(value)) {
    if (!value.length) args.push("-F", key + "[]");
    for (const entry of value) args.push("-f", `${key}[]=${entry}`);
  } else if (value !== null && typeof value === "object") {
    for (const [name, entry] of Object.entries(value)) append(args, `${key}[${name}]`, entry);
  } else args.push(value === null ? "-F" : "-f", `${key}=${value}`);
}
function numericArgs(
  command: Extract<GitHubBoardCommand, { kind: "field" }>,
  value: number,
): string[] {
  // gh -F converts integers, not decimal numbers. A validated finite numeric
  // literal is inserted into this fixed document; user text never enters it.
  const query = `mutation OttoKanbanWriteNumber($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
    updateProjectV2ItemFieldValue(input: {projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: {number: ${JSON.stringify(value)}}}) {projectV2Item {id}}
  }`;
  return [
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `projectId=${command.projectId}`,
    "-f",
    `itemId=${command.itemId}`,
    "-f",
    `fieldId=${command.fieldId}`,
  ];
}
export function githubBoardCommandArgs(input: GitHubBoardCommand): string[] {
  const command = GitHubBoardCommandSchema.parse(input);
  if (command.kind === "field" && command.value.kind === "number")
    return numericArgs(command, command.value.value);
  const operation = plan(command);
  const payload =
    operation.payload === "deletedItemId" ? operation.payload : `${operation.payload} {id}`;
  const query = `mutation OttoKanbanWrite($input: ${operation.inputType}!) {${operation.mutation}(input: $input) {${payload}}}`;
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(operation.input)) append(args, `input[${key}]`, value);
  return args;
}
const ReceiptSchema = z.object({
  data: z.record(
    z.string(),
    z.record(z.string(), z.union([z.string(), z.object({ id: z.string() })])),
  ),
  errors: z.array(z.unknown()).optional(),
});
export interface GitHubProjectWrites {
  execute(input: {
    cwd: string;
    command: GitHubBoardCommand;
  }): Promise<{ status: "applied"; id: string } | { status: "uncertain" }>;
}
export function createGitHubProjectWrites(ports: {
  run(args: string[], options: { cwd: string }): Promise<string>;
}): GitHubProjectWrites {
  return {
    async execute({ cwd, command }) {
      const args = githubBoardCommandArgs(command);
      try {
        const receipt = ReceiptSchema.safeParse(JSON.parse(await ports.run(args, { cwd })));
        if (!receipt.success || receipt.data.errors?.length) return { status: "uncertain" };
        const operation =
          command.kind === "field" && command.value.kind === "number"
            ? { mutation: "updateProjectV2ItemFieldValue", payload: "projectV2Item" }
            : plan(command);
        const result = receipt.data.data[operation.mutation]?.[operation.payload];
        const resultId = typeof result === "string" ? result : result?.id;
        const expectedId = command.kind === "content" ? command.contentId : undefined;
        if (expectedId && resultId !== expectedId) return { status: "uncertain" };
        if (
          (command.kind === "field" || command.kind === "remove" || command.kind === "iteration") &&
          resultId !== command.itemId
        )
          return { status: "uncertain" };
        return resultId ? { status: "applied", id: resultId } : { status: "uncertain" };
      } catch {
        // Even a failed CLI process may have lost an accepted mutation response.
        return { status: "uncertain" };
      }
    },
  };
}
