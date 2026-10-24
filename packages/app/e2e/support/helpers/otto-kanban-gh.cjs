// Synthetic official-shaped Projects responses, used only by the isolated local-fixture gh shim.
const fs = require("node:fs");
const path = require("node:path");

const page = { hasNextPage: false, endCursor: null };
const header = {
  __typename: "ProjectV2",
  id: "PVT_otto_fixture",
  updatedAt: "2026-10-24T00:00:00Z",
};

function item(id, kind, title, optionId) {
  return {
    id,
    isArchived: false,
    fieldValueByName: {
      __typename: "ProjectV2ItemFieldSingleSelectValue",
      optionId,
      field: { id: "status" },
    },
    content: {
      __typename: kind,
      title,
      body: "Work from the configured project board.",
      ...(kind === "Issue" ? { url: "https://github.com/paseo-e2e/local-fixture/issues/1" } : {}),
      assignees: { nodes: [{ login: "fixture-user" }], pageInfo: page },
    },
  };
}

module.exports = function reply(args) {
  const query = args.find((value) => value.startsWith("query="))?.slice(6) ?? "";
  const operation = query.match(/^query\s+(OttoKanban\w+)/)?.[1];
  if (args[0] !== "api" || args[1] !== "graphql" || !operation) return false;
  const directory = path.join(process.cwd(), ".tmp", "kanban-fixture");
  const state = JSON.parse(fs.readFileSync(path.join(directory, "state.json"), "utf8"));
  const cursor = args.find((value) => value.startsWith("cursor="))?.slice(7) ?? "null";
  fs.appendFileSync(
    path.join(directory, "requests.jsonl"),
    JSON.stringify({ operation, cursor }) + "\n",
  );
  let result;
  if (state.error === "scope") {
    result = {
      errors: [{ type: "INSUFFICIENT_SCOPES", message: "Fixture requires project scopes." }],
    };
  } else if (operation === "OttoKanbanProject") {
    result = { data: { repositoryOwner: { projectV2: { id: header.id } } } };
  } else if (operation === "OttoKanbanRepository") {
    result = {
      data: { repository: { projectsV2: { nodes: [{ id: header.id }], totalCount: 1 } } },
    };
  } else if (operation === "OttoKanbanFields") {
    const first = cursor === "null";
    result = {
      data: {
        node: {
          ...header,
          title: "Otto fixture board",
          url: "https://github.com/orgs/paseo-e2e/projects/42",
          fields: {
            nodes: first
              ? [
                  {
                    __typename: "ProjectV2SingleSelectField",
                    id: "status",
                    name: "Status",
                    options: [
                      { id: "todo", name: "Todo" },
                      { id: "done", name: "Done" },
                    ],
                  },
                ]
              : [{ __typename: "ProjectV2Field", id: "notes", name: "Notes" }],
            pageInfo: first ? { hasNextPage: true, endCursor: "fields-page-2" } : page,
          },
        },
      },
    };
  } else if (operation === "OttoKanbanItems") {
    const first = cursor === "null";
    result = {
      data: {
        node: {
          ...header,
          items: {
            nodes: first
              ? [item("issue-1", "Issue", "Coordinate the release", "todo")]
              : [item("draft-2", "DraftIssue", "Review the implementation", "done")],
            pageInfo: first ? { hasNextPage: true, endCursor: "items-page-2" } : page,
          },
        },
      },
    };
  } else {
    throw new Error("Unsupported local Kanban query");
  }
  process.stdout.write(JSON.stringify(result));
  return true;
};
