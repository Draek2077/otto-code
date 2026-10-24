// Synthetic official-shaped Projects responses, used only by the isolated local-fixture gh shim.
const fs = require("node:fs");
const path = require("node:path");
const fixture = require("./otto-kanban-gh-board.cjs");
const write = require("./otto-kanban-gh-write.cjs");

const page = { hasNextPage: false, endCursor: null };
const header = {
  __typename: "ProjectV2",
  id: "PVT_otto_fixture",
  updatedAt: "2026-10-24T00:00:00Z",
};
function items(state, cursor) {
  const first = cursor === "null";
  const hasMore = first && state.cards.length > 1;
  const cards = first ? state.cards.slice(0, 1) : state.cards.slice(1);
  return {
    data: {
      node: {
        ...fixture.header(state),
        items: {
          nodes: cards.map((card) => fixture.item(state, card)),
          pageInfo: hasMore ? { hasNextPage: true, endCursor: "items-page-2" } : page,
        },
      },
    },
  };
}

module.exports = function reply(args) {
  const query = args.find((value) => value.startsWith("query="))?.slice(6) ?? "";
  const operation = query.match(/^(?:query|mutation)\s+(OttoKanban\w+)/)?.[1];
  if (args[0] !== "api" || args[1] !== "graphql" || !operation) return false;
  const directory = path.join(process.cwd(), ".tmp", "kanban-fixture");
  const state = JSON.parse(fs.readFileSync(path.join(directory, "state.json"), "utf8"));
  fixture.initialize(state);
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
          ...fixture.header(state),
          title: "Otto fixture board",
          url: "https://github.com/orgs/paseo-e2e/projects/42",
          fields: {
            nodes: first ? fixture.fields().slice(0, 1) : fixture.fields().slice(1),
            pageInfo: first ? { hasNextPage: true, endCursor: "fields-page-2" } : page,
          },
        },
      },
    };
  } else if (operation === "OttoKanbanItems") {
    result = items(state, cursor);
  } else if (operation.startsWith("OttoKanbanWrite")) {
    result = write(query, state, args);
    fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify(state));
  } else if (
    [
      "OttoKanbanEditableFields",
      "OttoKanbanCardDetails",
      "OttoKanbanRepositoryChoices",
      "OttoKanbanLinkContent",
    ].includes(operation)
  ) {
    result = fixture.read(operation, state, args);
  } else {
    throw new Error("Unsupported local Kanban query");
  }
  process.stdout.write(JSON.stringify(result));
  return true;
};
