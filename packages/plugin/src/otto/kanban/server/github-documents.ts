// Official schema: https://docs.github.com/en/graphql/reference/projects
// Read-only documents. Keep field unions behind ProjectV2FieldCommon and use
// ProjectV2SingleSelectField.options as a list, not a Relay connection.
export const resolveNumberDocument = `query OttoKanbanProject($owner: String!, $number: Int!) {
  repositoryOwner(login: $owner) {
    ... on Organization { projectV2(number: $number) { id } }
    ... on User { projectV2(number: $number) { id } }
  }
}`;

export const discoverRepositoryDocument = `query OttoKanbanRepository($owner: String!, $repository: String!) {
  repository(owner: $owner, name: $repository) {
    projectsV2(first: 2) { nodes { id } totalCount }
  }
}`;

export const readFieldsDocument = `query OttoKanbanFields($id: ID!, $cursor: String) {
  node(id: $id) {
    __typename
    ... on ProjectV2 {
      id title url updatedAt
      fields(first: 100, after: $cursor) {
        nodes {
          __typename
          ... on ProjectV2FieldCommon { id name }
          ... on ProjectV2SingleSelectField { options { id name } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const assignees = `assignees(first: 100) {
  nodes { login }
  pageInfo { hasNextPage endCursor }
}`;
export const readItemsDocument = `query OttoKanbanItems($id: ID!, $cursor: String, $statusName: String!) {
  node(id: $id) {
    __typename
    ... on ProjectV2 {
      id updatedAt
      items(first: 100, after: $cursor) {
        nodes {
          id isArchived
          fieldValueByName(name: $statusName) {
            __typename
            ... on ProjectV2ItemFieldSingleSelectValue {
              optionId
              field { ... on ProjectV2FieldCommon { id } }
            }
          }
          content {
            __typename
            ... on DraftIssue { title body ${assignees} }
            ... on Issue { title body url ${assignees} }
            ... on PullRequest { title body url ${assignees} }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;
