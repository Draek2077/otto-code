/**
 * Proves every GraphQL document in the GitHub Projects v2 Kanban provider is
 * valid against the live GitHub schema.
 *
 * Run it with `npm run validate:kanban-graphql -w @otto-code/server`. It needs a
 * signed-in `gh` CLI and makes only failing requests.
 *
 * Why this exists: every document in the provider once named types and mutations
 * that do not exist (`ProjectV2FieldSingleSelect`, `addProjectV2ItemToProject`,
 * selections straight off the `ProjectV2FieldConfiguration` union). GitHub
 * rejected them during *validation*, before executing anything, so no amount of
 * response-shape unit testing could see it - the stubbed fetch never had an
 * opinion about whether the query it was handed was legal.
 *
 * The trick: send each document with deliberately non-resolving ids. A document
 * that is schema-valid reaches execution and answers NOT_FOUND, which carries a
 * `type` and a `path`. A document that is not valid is rejected with neither, so
 * the two are trivially distinguishable and nothing is ever created or changed.
 *
 * The unit suite's "the documents GitHub actually accepts" block guards the same
 * mistakes offline; this is the half that can only be answered by GitHub.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const PROVIDER = new URL("../src/server/kanban/github-provider.ts", import.meta.url);
const src = readFileSync(PROVIDER, "utf8");

// Evaluate every top-level string const in file order, so documents built from
// shared selection fragments resolve the same way the provider builds them.
const scope = {
  ITEM_PAGE_SIZE: 100,
  FIELD_PAGE_SIZE: 100,
  ITEM_FIELD_VALUE_PAGE_SIZE: 50,
};
const order = [];
const re = /^const ([A-Z0-9_]+) =\s*([\s\S]*?);\s*$/gm;
for (const m of src.matchAll(re)) {
  const [, name, body] = m;
  if (name in scope) continue;
  let value;
  try {
    value = new Function(...Object.keys(scope), `return (${body});`)(...Object.values(scope));
  } catch {
    continue; // Not a string expression (page sizes, arrays, objects).
  }
  if (typeof value !== "string") continue;
  scope[name] = value;
  if (/(QUERY|MUTATION)$/.test(name)) order.push(name);
}

const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();

// Dummy variables: syntactically valid, guaranteed not to resolve.
const DUMMY = {
  id: "PVT_kwDOAAAAAA4AAAAA",
  ids: ["R_kgDOAAAAAA"],
  login: "otto-nonexistent-login-probe",
  name: "otto-nonexistent-repo-probe",
  owner: "otto-nonexistent-login-probe",
  number: 999999,
  projectId: "PVT_kwDOAAAAAA4AAAAA",
  itemId: "PVTI_kwDOAAAAAA4AAAAA",
  fieldId: "PVTSSF_kwDOAAAAAA4AAAAA",
  optionId: "abcd1234",
  contentId: "I_kwDOAAAAAA4AAAAA",
  title: "otto graphql validation probe",
  body: "probe",
  assigneeIds: [],
  labelIds: [],
  value: { text: "probe" },
  fieldCursor: null,
  itemCursor: null,
};

function variablesFor(text) {
  const vars = {};
  for (const m of text.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
    if (m[1] in DUMMY) vars[m[1]] = DUMMY[m[1]];
  }
  return vars;
}

let failed = 0;
for (const name of order) {
  const text = scope[name];
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Otto",
    },
    body: JSON.stringify({ query: text, variables: variablesFor(text) }),
  });
  const payload = await res.json();
  const errors = payload.errors ?? [];
  // A validation failure has no `type` and no `path`: it is reported against
  // the document's own locations before anything executes.
  const validation = errors.filter((e) => !e.type && !e.path);
  if (validation.length > 0) {
    failed += 1;
    console.log(`INVALID DOCUMENT  ${name}`);
    for (const e of validation) console.log(`    ${e.message}`);
  } else {
    const exec = errors.map((e) => `${e.type ?? "ERR"} @${(e.path ?? []).join(".")}`).join(", ");
    console.log(`valid             ${name}${exec ? `  (execution: ${exec})` : ""}`);
  }
}
console.log(`\n${order.length} documents checked, ${failed} invalid.`);
process.exit(failed > 0 ? 1 : 0);
