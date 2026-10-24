// Isolated fixture data only. No CLI, credentials, host configuration or network access.
const page = { hasNextPage: false, endCursor: null };
const directoryUrl = "https://github.com/paseo-e2e/local-fixture";
function initialize(state) {
  state.version ??= 0;
  state.nextId ??= 3;
  state.cards ??= [
    {
      id: "issue-1",
      contentId: "content-issue-1",
      kind: "Issue",
      title: "Coordinate the release",
      body: "Work from the configured project board.",
      column: "todo",
      url: directoryUrl + "/issues/1",
      people: ["fixture-user"],
      labels: ["bug"],
      fields: {},
    },
    {
      id: "draft-2",
      contentId: "content-draft-2",
      kind: "DraftIssue",
      title: "Review the implementation",
      body: "Work from the configured project board.",
      column: "done",
      people: ["fixture-user"],
      labels: [],
      fields: {},
    },
  ];
}
function header(state) {
  return {
    __typename: "ProjectV2",
    id: "PVT_otto_fixture",
    updatedAt: new Date(Date.UTC(2026, 9, 24, 0, 0, state.version)).toISOString(),
  };
}
function content(state, card) {
  return {
    __typename: card.kind,
    id: card.contentId,
    title: card.title,
    body: card.body,
    updatedAt: header(state).updatedAt,
    viewerCanUpdate: state.contentWritable !== false,
    repository: { id: "repository", nameWithOwner: "paseo-e2e/local-fixture" },
    ...(card.url ? { url: card.url } : {}),
    assignees: { nodes: card.people.map((id) => ({ id, login: id })), pageInfo: page },
    labels: {
      nodes: card.labels.map((id) => ({ id, name: id === "bug" ? "Bug" : id })),
      pageInfo: page,
    },
  };
}
function item(state, card) {
  return {
    id: card.id,
    isArchived: false,
    fieldValueByName: {
      __typename: "ProjectV2ItemFieldSingleSelectValue",
      optionId: card.column,
      field: { id: "status" },
    },
    content: content(state, card),
  };
}
function fields() {
  return [
    {
      __typename: "ProjectV2SingleSelectField",
      id: "status",
      name: "Status",
      dataType: "SINGLE_SELECT",
      options: [
        { id: "todo", name: "Todo" },
        { id: "done", name: "Done" },
      ],
    },
    { __typename: "ProjectV2Field", id: "notes", name: "Notes", dataType: "TEXT" },
    { __typename: "ProjectV2Field", id: "title", name: "Title", dataType: "TITLE" },
    { __typename: "ProjectV2Field", id: "people", name: "Assignees", dataType: "ASSIGNEES" },
    { __typename: "ProjectV2Field", id: "labels", name: "Labels", dataType: "LABELS" },
    {
      __typename: "ProjectV2SingleSelectField",
      id: "priority",
      name: "Priority",
      dataType: "SINGLE_SELECT",
      options: [
        { id: "high", name: "High" },
        { id: "low", name: "Low" },
      ],
    },
    { __typename: "ProjectV2Field", id: "due", name: "Due date", dataType: "DATE" },
  ];
}
function value(args, key) {
  return args.find((arg) => arg.startsWith(key + "="))?.slice(key.length + 1);
}
function read(operation, state, args) {
  if (operation === "OttoKanbanEditableFields") {
    const first = value(args, "cursor") === "null";
    return {
      data: {
        node: {
          ...header(state),
          viewerCanUpdate: state.writable !== false,
          fields: {
            nodes: first ? fields().slice(0, 1) : fields().slice(1),
            pageInfo: first ? { hasNextPage: true, endCursor: "editable-fields-2" } : page,
          },
        },
      },
    };
  }
  if (operation === "OttoKanbanCardDetails") {
    const card = state.cards.find((row) => row.id === value(args, "id"));
    return {
      data: {
        node: card
          ? {
              id: card.id,
              project: { id: header(state).id },
              updatedAt: header(state).updatedAt,
              content: content(state, card),
              fieldValues: {
                nodes: Object.entries(card.fields).map(([id, field]) =>
                  Object.assign({ field: { id } }, field),
                ),
                pageInfo: page,
              },
            }
          : null,
      },
    };
  }
  if (operation === "OttoKanbanRepositoryChoices")
    return {
      data: {
        repository: {
          id: "repository",
          assignableUsers: {
            nodes: [
              { id: "fixture-user", login: "fixture-user" },
              { id: "fixture-peer", login: "fixture-peer" },
            ],
            pageInfo: page,
          },
          labels: {
            nodes: [
              { id: "bug", name: "Bug" },
              { id: "enhancement", name: "Enhancement" },
            ],
            pageInfo: page,
          },
        },
      },
    };
  if (operation === "OttoKanbanLinkContent")
    return {
      data: { resource: { __typename: "Issue", id: "content-linked", url: value(args, "url") } },
    };
  throw new Error("Unsupported fixture detail query");
}
module.exports = { initialize, header, content, item, fields, value, read, page, directoryUrl };
