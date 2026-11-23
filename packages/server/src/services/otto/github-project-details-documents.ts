// Official Projects reference: https://docs.github.com/en/graphql/reference/projects
export const editableFieldsDocument = `query OttoKanbanEditableFields($id: ID!, $cursor: String) {
  node(id: $id) { ... on ProjectV2 {
    id updatedAt viewerCanUpdate
    fields(first: 100, after: $cursor) {
      nodes {
        __typename
        ... on ProjectV2FieldCommon { id name dataType }
        ... on ProjectV2SingleSelectField { options {id name} }
        ... on ProjectV2MultiSelectField { multiSelectOptions {id name} }
        ... on ProjectV2IterationField { configuration {iterations {id title} completedIterations {id title}} }
      }
      pageInfo {hasNextPage endCursor}
    }
  } }
}`;
const people = `assignees(first: 100) {nodes {id login} pageInfo {hasNextPage endCursor}}`;
const labels = `labels(first: 100) {nodes {id name} pageInfo {hasNextPage endCursor}}`;
const repository = `repository {id nameWithOwner}`;
export const cardDetailsDocument = `query OttoKanbanCardDetails($id: ID!, $cursor: String) {
  node(id: $id) { ... on ProjectV2Item {
    id updatedAt project {id}
    content {
      __typename
      ... on DraftIssue {id title body ${people}}
      ... on Issue {id title body updatedAt viewerCanUpdate ${repository} ${people} ${labels}}
      ... on PullRequest {id title body updatedAt viewerCanUpdate ${repository} ${people} ${labels}}
    }
    fieldValues(first: 100, after: $cursor) {
      nodes {
        __typename
        ... on ProjectV2ItemFieldTextValue {text field {... on ProjectV2FieldCommon {id}}}
        ... on ProjectV2ItemFieldNumberValue {number field {... on ProjectV2FieldCommon {id}}}
        ... on ProjectV2ItemFieldDateValue {date field {... on ProjectV2FieldCommon {id}}}
        ... on ProjectV2ItemFieldSingleSelectValue {optionId field {... on ProjectV2FieldCommon {id}}}
        ... on ProjectV2ItemFieldMultiSelectValue {options {id name} field {... on ProjectV2FieldCommon {id}}}
        ... on ProjectV2ItemFieldIterationValue {iterationId field {... on ProjectV2FieldCommon {id}}}
      }
      pageInfo {hasNextPage endCursor}
    }
  } }
}`;
export const repositoryChoicesDocument = `query OttoKanbanRepositoryChoices($owner: String!, $repository: String!, $peopleCursor: String, $labelsCursor: String) {
  repository(owner: $owner, name: $repository) {
    id assignableUsers(first: 100, after: $peopleCursor) {nodes {id login} pageInfo {hasNextPage endCursor}}
    labels(first: 100, after: $labelsCursor) {nodes {id name} pageInfo {hasNextPage endCursor}}
  }
}`;
export const linkContentDocument = `query OttoKanbanLinkContent($url: URI!) {
  resource(url: $url) {
    __typename
    ... on Issue {id url}
    ... on PullRequest {id url}
  }
}`;
