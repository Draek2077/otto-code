import { expect, it } from "vitest";
import {
  createGitHubProjectWrites,
  githubBoardCommandArgs,
  type GitHubBoardCommand,
} from "./github-project-commands.js";

function fixture() {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const output = {
    value: JSON.stringify({ data: { addProjectV2DraftIssue: { projectItem: { id: "item" } } } }),
    fail: false,
  };
  const port = createGitHubProjectWrites({
    run: async (args, options) => {
      calls.push({ args, cwd: options.cwd });
      if (output.fail) throw new Error("Response lost");
      return output.value;
    },
  });
  return { calls, output, port };
}
const create: GitHubBoardCommand = {
  kind: "create",
  projectId: "project",
  title: "@sensitive-file",
  body: "{owner}\n$() and quotes stay literal",
};
it("sends one explicit draft creation through the owning gh runner with literal text", async () => {
  const f = fixture();
  expect(await f.port.execute({ cwd: "owning-project", command: create })).toEqual({
    status: "applied",
    id: "item",
  });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]?.cwd).toBe("owning-project");
  const args = f.calls[0]!.args;
  expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
  expect(args).toContain("input[title]=@sensitive-file");
  expect(args[args.indexOf("input[title]=@sensitive-file") - 1]).toBe("-f");
  expect(args).toContain("input[body]={owner}\n$() and quotes stay literal");
  expect(args.join(" ")).not.toMatch(/auth login|auth refresh|auth switch|--hostname|--input/);
});
it("removes only the project item, never the underlying issue", async () => {
  const f = fixture();
  f.output.value = JSON.stringify({ data: { deleteProjectV2Item: { deletedItemId: "item" } } });
  expect(
    await f.port.execute({
      cwd: "project",
      command: { kind: "remove", projectId: "board", itemId: "item" },
    }),
  ).toEqual({ status: "applied", id: "item" });
  expect(f.calls[0]!.args.join(" ")).toContain("deleteProjectV2Item");
  expect(f.calls[0]!.args.join(" ")).not.toContain("deleteIssue");
});
it("links content by its validated provider node ID", () => {
  const args = githubBoardCommandArgs({
    kind: "link",
    projectId: "board",
    contentId: "issue-node",
  });
  expect(args).toContain("input[contentId]=issue-node");
  expect(args[3]).toContain("addProjectV2ItemById");
});
it.each(["DraftIssue", "Issue", "PullRequest"] as const)(
  "updates only the explicitly edited %s content field",
  async (contentKind) => {
    const f = fixture();
    const type = {
      DraftIssue: ["updateProjectV2DraftIssue", "draftIssue", "draftIssueId"],
      Issue: ["updateIssue", "issue", "id"],
      PullRequest: ["updatePullRequest", "pullRequest", "pullRequestId"],
    }[contentKind];
    f.output.value = JSON.stringify({ data: { [type[0]!]: { [type[1]!]: { id: "content" } } } });
    expect(
      await f.port.execute({
        cwd: "project",
        command: {
          kind: "content",
          contentKind,
          contentId: "content",
          field: "title",
          value: "Edited",
        },
      }),
    ).toEqual({ status: "applied", id: "content" });
    expect(f.calls[0]!.args).toContain(`input[${type[2]}]=content`);
    expect(f.calls[0]!.args).toContain("input[title]=Edited");
    expect(f.calls[0]!.args.join(" ")).not.toContain("input[body]");
  },
);
it("clears assignees with an actual empty array and preserves opaque IDs as strings", () => {
  const empty = githubBoardCommandArgs({
    kind: "content",
    contentKind: "Issue",
    contentId: "123",
    field: "assigneeIds",
    value: [],
  });
  expect(empty).toContain("input[assigneeIds][]");
  expect(empty[empty.indexOf("input[assigneeIds][]") - 1]).toBe("-F");
  expect(empty[empty.indexOf("input[id]=123") - 1]).toBe("-f");
  const filled = githubBoardCommandArgs({
    kind: "content",
    contentKind: "Issue",
    contentId: "123",
    field: "labelIds",
    value: ["001", "@file"],
  });
  expect(filled).toContain("input[labelIds][]=001");
  expect(filled[filled.indexOf("input[labelIds][]=@file") - 1]).toBe("-f");
});
it("uses a fixed finite decimal literal because gh -F only converts integers", () => {
  const args = githubBoardCommandArgs({
    kind: "field",
    projectId: "board",
    itemId: "item",
    fieldId: "field",
    value: { kind: "number", value: 3.25 },
  });
  expect(args[3]).toContain("number: 3.25");
  expect(args).toContain("fieldId=field");
  expect(() =>
    githubBoardCommandArgs({
      kind: "field",
      projectId: "board",
      itemId: "item",
      fieldId: "field",
      value: { kind: "number", value: Number.POSITIVE_INFINITY },
    }),
  ).toThrow();
});
it("clears a project field through the dedicated mutation", () => {
  const args = githubBoardCommandArgs({
    kind: "field",
    projectId: "board",
    itemId: "item",
    fieldId: "field",
    value: { kind: "clear" },
  });
  expect(args[3]).toContain("clearProjectV2ItemFieldValue");
  expect(args.join(" ")).not.toContain("input[value]");
});
it("encodes an iteration as its own provider field value", () => {
  const args = githubBoardCommandArgs({
    kind: "iteration",
    projectId: "board",
    itemId: "item",
    fieldId: "field",
    iterationId: "iteration",
  });
  expect(args).toContain("input[value][iterationId]=iteration");
  expect(args[3]).toContain("updateProjectV2ItemFieldValue");
});
it.each(["text", "date", "choice", "choices"] as const)(
  "encodes the supported %s project field",
  (kind) => {
    const values = {
      text: { kind: "text" as const, value: "@literal" },
      date: { kind: "date" as const, value: "2026-10-24" },
      choice: { kind: "choice" as const, id: "option" },
      choices: { kind: "choices" as const, ids: ["a", "b"] },
    };
    const args = githubBoardCommandArgs({
      kind: "field",
      projectId: "board",
      itemId: "item",
      fieldId: "field",
      value: values[kind],
    });
    expect(args[3]).toContain("UpdateProjectV2ItemFieldValueInput");
    expect(args).toContain("input[fieldId]=field");
  },
);
it("refuses unsupported content fields before invoking any CLI", async () => {
  const f = fixture();
  await expect(
    f.port.execute({
      cwd: "project",
      command: {
        kind: "content",
        contentKind: "DraftIssue",
        contentId: "draft",
        field: "labelIds",
        value: ["label"],
      },
    }),
  ).rejects.toThrow("Drafts do not have repository labels");
  expect(f.calls).toEqual([]);
});
it.each(["lost", "invalid", "errors", "wrong-item", "wrong-payload"])(
  "does not retry or claim success for a %s response",
  async (mode) => {
    const f = fixture();
    if (mode === "lost") f.output.fail = true;
    if (mode === "invalid") f.output.value = "not-json";
    if (mode === "errors")
      f.output.value = JSON.stringify({
        data: { deleteProjectV2Item: { deletedItemId: "item" } },
        errors: [{ message: "Partial response" }],
      });
    if (mode === "wrong-item")
      f.output.value = JSON.stringify({
        data: { deleteProjectV2Item: { deletedItemId: "other" } },
      });
    if (mode === "wrong-payload")
      f.output.value = JSON.stringify({ data: { unrelated: { item: { id: "item" } } } });
    expect(
      await f.port.execute({
        cwd: "project",
        command: { kind: "remove", projectId: "board", itemId: "item" },
      }),
    ).toEqual({ status: "uncertain" });
    expect(f.calls).toHaveLength(1);
  },
);
