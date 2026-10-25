import { expect, it } from "vitest";
import { getJiraCreateOptions } from "./creation.js";
import { BoardMutationSchema } from "./mutations.js";
it("accepts old create payloads while keeping Jira selection optional and structural", () => {
  const previous = { kind: "create", title: "Title", description: "Body", columnId: null };
  expect(BoardMutationSchema.parse(previous)).toEqual(previous);
  const jira = {
    projectId: "project",
    issueTypeId: "task",
    expectedCreateRevision: "metadata-origin",
  };
  expect(BoardMutationSchema.parse({ ...previous, jira })).toEqual({ ...previous, jira });
});
it("requires explicit scope and opened settings/board revisions without credential or path slots", () => {
  const input = {
    binding: { hostId: "host", projectId: "project" },
    expectedSettingsRevision: "settings",
    expectedBoardRevision: "board",
  };
  expect(getJiraCreateOptions.input.parse(input)).toEqual(input);
  expect(getJiraCreateOptions.input.safeParse({ ...input, apiToken: "secret" }).success).toBe(
    false,
  );
  expect(
    getJiraCreateOptions.input.safeParse({
      ...input,
      binding: { ...input.binding, rootPath: "/foreign" },
    }).success,
  ).toBe(false);
  expect(getJiraCreateOptions.input.safeParse({ binding: input.binding }).success).toBe(false);
});
