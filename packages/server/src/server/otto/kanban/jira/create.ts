import { z } from "zod";
import { type BoardMutation, type Result } from "@getpaseo/plugin/otto/kanban";
import type { ProviderMutationResult } from "../mutations/service.js";
import { readJiraCreation } from "./creation-metadata.js";
import { jiraFieldPlan, type JiraEditField } from "./fields.js";
import { jiraDocument } from "./adf.js";
import { linkJiraIssue, placeLinkedIssue, type JiraBoardActionContext } from "./link.js";
import { readJiraBoard } from "./reader.js";

const CreatedSchema = z.object({ key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-[1-9]\d*$/) });
const rejected = (message: string): ProviderMutationResult => ({
  status: "rejected",
  error: { code: "invalid_target", message },
});
function validateDescription(
  text: string,
  field: JiraEditField | undefined,
): ProviderMutationResult | null {
  if (text && (!field || !jiraFieldPlan("description", field, []).writable))
    return rejected(
      "This Jira create screen does not accept a description. Keep your draft and use its supported fields.",
    );
  if (field?.required && !field.hasDefaultValue && !text.trim())
    return rejected("Enter the description required by Jira.");
  return null;
}
async function reconcileCreated(
  context: JiraBoardActionContext,
  key: string,
  columnId: string | null,
  beforeWrite: () => Promise<Result<true>>,
): Promise<ProviderMutationResult> {
  const board = await readJiraBoard({
    http: context.http,
    boardId: context.board.id,
    siteUrl: context.siteUrl,
  });
  if (board.ok) {
    const result = board.value.board.cards.some((card) => card.id === key)
      ? await placeLinkedIssue(context, key, columnId, beforeWrite)
      : await linkJiraIssue({ kind: "link", reference: key, columnId }, context, beforeWrite);
    if (result.status === "applied") return result;
  }
  return {
    status: "uncertain",
    error: {
      code: "unavailable",
      message: `Jira created ${key}, but its board placement is not verified. Check that issue before creating or linking again.`,
    },
  };
}
export async function createJiraIssue(
  mutation: Extract<BoardMutation, { kind: "create" }>,
  context: JiraBoardActionContext,
  beforeWrite: () => Promise<Result<true>>,
): Promise<ProviderMutationResult> {
  if (!mutation.jira)
    return rejected("Choose a Jira project and issue type before creating an issue.");
  if (
    mutation.columnId !== null &&
    !context.configuration.columnConfig.columns.some((column) => column.name === mutation.columnId)
  )
    return rejected("Choose a current Jira column before creating an issue.");
  const selection = mutation.jira;
  const metadata = await readJiraCreation(context, selection);
  if (!metadata.ok) return { status: "rejected", error: metadata.error };
  if (metadata.value.options.revision !== selection.expectedCreateRevision)
    return {
      status: "rejected",
      error: {
        code: "revision_conflict",
        message: "Jira's creation fields changed. Reload the form before creating the issue.",
      },
    };
  if (!metadata.value.options.available)
    return rejected(metadata.value.options.message ?? "Use Jira's required creation screen.");
  const invalidDescription = validateDescription(
    mutation.description,
    metadata.value.fields.get("description"),
  );
  if (invalidDescription) return invalidDescription;
  if (!mutation.title.trim() || mutation.title.length > 255)
    return rejected("Enter a Jira title between 1 and 255 characters.");
  const ready = await beforeWrite();
  if (!ready.ok) return { status: "rejected", error: ready.error };
  const result = await context.http.write("POST", "/rest/api/3/issue", {
    fields: {
      project: { id: selection.projectId },
      issuetype: { id: selection.issueTypeId },
      summary: mutation.title,
      ...(mutation.description ? { description: jiraDocument(mutation.description) } : {}),
    },
  });
  if (result.status !== "applied") return result;
  const created = CreatedSchema.safeParse(result.value);
  if (!created.success)
    return {
      status: "uncertain",
      error: {
        code: "invalid_response",
        message:
          "Jira may have created an issue but did not return its identity. Check the project before another attempt.",
      },
    };
  return reconcileCreated(context, created.data.key, mutation.columnId, beforeWrite);
}
