import type { BoardMutationIntent } from "@getpaseo/plugin/otto/kanban";
import type { ProviderMutationResult } from "../mutations/service.js";
import { jiraWriteValue } from "./fields.js";
import type { JiraMutationContext } from "./details.js";

export async function executeJiraCard(
  intent: BoardMutationIntent,
  context: JiraMutationContext,
): Promise<ProviderMutationResult> {
  const mutation = intent.mutation;
  if (!("cardId" in mutation) || context.issue.key !== mutation.cardId)
    return {
      status: "rejected",
      error: { code: "not_found", message: "Refresh the issue before editing it." },
    };
  const endpoint = "/rest/api/3/issue/" + encodeURIComponent(context.issue.key);
  if (mutation.kind === "remove")
    return {
      status: "rejected",
      error: {
        code: "unsupported",
        message:
          "Jira does not support detaching an issue from its filtered board. The issue was kept.",
      },
    };
  if (mutation.kind === "move") {
    const transition = context.transitions.get(mutation.columnId);
    if (!transition)
      return {
        status: "rejected",
        error: {
          code: "unsupported",
          message:
            "This column has no unambiguous available workflow transition without additional required fields.",
        },
      };
    const result = await context.http.write("POST", endpoint + "/transitions", {
      transition: { id: transition },
    });
    return result.status === "applied"
      ? { status: "applied" }
      : { status: result.status, error: result.error };
  }
  const plan = context.plans.get(mutation.fieldId);
  if (!plan)
    return {
      status: "rejected",
      error: {
        code: "unsupported",
        message: "This field is not available on the issue's edit screen.",
      },
    };
  const value = jiraWriteValue(plan, mutation.value);
  if (!value.ok) return { status: "rejected", error: value.error };
  const result = await context.http.write("PUT", endpoint, {
    fields: { [mutation.fieldId]: value.value },
  });
  return result.status === "applied"
    ? { status: "applied" }
    : { status: result.status, error: result.error };
}
