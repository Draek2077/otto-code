const fixture = require("./otto-kanban-gh-board.cjs");
function required(args, key) {
  const result = fixture.value(args, key);
  if (result === undefined) throw new Error("Missing fixture mutation field: " + key);
  return result;
}
function fieldWrite(state, args) {
  const card = state.cards.find((row) => row.id === required(args, "input[itemId]"));
  if (!card) throw new Error("Unknown fixture card");
  const field = required(args, "input[fieldId]");
  const option = fixture.value(args, "input[value][singleSelectOptionId]");
  if (field === "status") card.column = option ?? null;
  else if (option !== undefined)
    card.fields[field] = { __typename: "ProjectV2ItemFieldSingleSelectValue", optionId: option };
  else if (fixture.value(args, "input[value][text]") !== undefined)
    card.fields[field] = {
      __typename: "ProjectV2ItemFieldTextValue",
      text: fixture.value(args, "input[value][text]"),
    };
  else if (fixture.value(args, "input[value][date]") !== undefined)
    card.fields[field] = {
      __typename: "ProjectV2ItemFieldDateValue",
      date: fixture.value(args, "input[value][date]"),
    };
  else delete card.fields[field];
  return card.id;
}
module.exports = function write(query, state, args) {
  let result;
  if (query.includes("addProjectV2DraftIssue(")) {
    const id = "draft-" + state.nextId++;
    state.cards.push({
      id,
      contentId: "content-" + id,
      kind: "DraftIssue",
      title: required(args, "input[title]"),
      body: required(args, "input[body]"),
      column: null,
      people: [],
      labels: [],
      fields: {},
    });
    result = { data: { addProjectV2DraftIssue: { projectItem: { id } } } };
  } else if (query.includes("addProjectV2ItemById(")) {
    const id = "linked-" + state.nextId++;
    state.cards.push({
      id,
      contentId: required(args, "input[contentId]"),
      kind: "Issue",
      title: "Linked issue",
      body: "Linked body",
      column: null,
      url: fixture.directoryUrl + "/issues/2",
      people: [],
      labels: [],
      fields: {},
    });
    result = { data: { addProjectV2ItemById: { item: { id } } } };
  } else if (query.includes("deleteProjectV2Item(")) {
    const id = required(args, "input[itemId]");
    state.cards = state.cards.filter((row) => row.id !== id);
    result = { data: { deleteProjectV2Item: { deletedItemId: id } } };
  } else if (
    query.includes("updateProjectV2ItemFieldValue(") ||
    query.includes("clearProjectV2ItemFieldValue(")
  ) {
    const id = fieldWrite(state, args);
    const name = query.includes("clearProjectV2ItemFieldValue(")
      ? "clearProjectV2ItemFieldValue"
      : "updateProjectV2ItemFieldValue";
    result = { data: { [name]: { projectV2Item: { id } } } };
  } else {
    const id =
      fixture.value(args, "input[id]") ??
      fixture.value(args, "input[draftIssueId]") ??
      required(args, "input[pullRequestId]");
    const card = state.cards.find((row) => row.contentId === id);
    if (!card) throw new Error("Unknown fixture content");
    for (const name of ["title", "body"]) {
      const text = fixture.value(args, `input[${name}]`);
      if (text !== undefined) card[name] = text;
    }
    for (const [field, property] of [
      ["assigneeIds", "people"],
      ["labelIds", "labels"],
    ]) {
      const key = `input[${field}][]`;
      if (args.some((arg) => arg === key || arg.startsWith(key + "=")))
        card[property] = args
          .filter((arg) => arg.startsWith(key + "="))
          .map((arg) => arg.slice(key.length + 1));
    }
    const type = {
      Issue: ["updateIssue", "issue"],
      DraftIssue: ["updateProjectV2DraftIssue", "draftIssue"],
      PullRequest: ["updatePullRequest", "pullRequest"],
    }[card.kind];
    result = { data: { [type[0]]: { [type[1]]: { id } } } };
  }
  state.version++;
  if (state.error === "after-write")
    result.errors = [{ message: "Synthetic lost mutation response" }];
  return result;
};
