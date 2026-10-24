// Synthetic official-shape fixtures, not captured live-board acceptance.
// Reviewed against https://docs.github.com/en/graphql/reference/projects and
// https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects
// on 2026-10-23. No real repository contents, credentials or vendor writes.
export const binding = { hostId: "host-a", projectId: "project-a" };
export const page = { hasNextPage: false, endCursor: null };
export const header = {
  __typename: "ProjectV2",
  id: "PVT_board",
  updatedAt: "2026-10-23T00:00:00Z",
};

export function fieldsFixture() {
  return {
    data: {
      node: {
        ...header,
        title: "Shared project",
        url: "https://github.com/orgs/shared/projects/7",
        fields: {
          nodes: [
            {
              __typename: "ProjectV2SingleSelectField",
              id: "priority",
              name: "Priority",
              options: [{ id: "urgent", name: "Urgent" }],
            },
            {
              __typename: "ProjectV2SingleSelectField",
              id: "status",
              name: "Status",
              options: [
                { id: "todo", name: "Todo" },
                { id: "done", name: "Done" },
              ],
            },
            { __typename: "ProjectV2IterationField", id: "iteration", name: "Iteration" },
          ],
          pageInfo: { ...page },
        },
      },
    },
  };
}

export function itemFixture(kind: "DraftIssue" | "Issue" | "PullRequest" = "Issue", id = "item-1") {
  return {
    id,
    isArchived: false,
    fieldValueByName: {
      __typename: "ProjectV2ItemFieldSingleSelectValue",
      optionId: "todo",
      field: { id: "status" },
    },
    content: {
      __typename: kind,
      title: `${kind} title`,
      body: "Description",
      ...(kind === "DraftIssue" ? {} : { url: "https://github.com/shared/repo/issues/1" }),
      assignees: { nodes: [{ login: "person" }], pageInfo: { ...page } },
    },
  };
}

export function itemsFixture() {
  return {
    data: {
      node: {
        ...header,
        items: {
          nodes: [
            itemFixture("Issue", "issue"),
            itemFixture("PullRequest", "pr"),
            itemFixture("DraftIssue", "draft"),
          ],
          pageInfo: { ...page },
        },
      },
    },
  };
}

export function fieldLimitPageFixture(index: number) {
  const nodes = Array.from({ length: 100 }, (_entry, offset) => ({
    __typename: "ProjectV2Field",
    id: `field-${index * 100 + offset}`,
    name: "Text",
  }));
  return {
    data: {
      node: {
        ...fieldsFixture().data.node,
        fields: { nodes, pageInfo: { hasNextPage: true, endCursor: `fields-${index}` } },
      },
    },
  };
}

export function itemLimitPageFixture(index: number) {
  const nodes = Array.from({ length: 100 }, (_entry, offset) =>
    itemFixture("Issue", `item-${index * 100 + offset}`),
  );
  return {
    data: {
      node: {
        ...header,
        items: { nodes, pageInfo: { hasNextPage: true, endCursor: `items-${index}` } },
      },
    },
  };
}
