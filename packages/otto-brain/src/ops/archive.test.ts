import path from "node:path";
import assert from "node:assert/strict";
import { fixtureRoot } from "../../test-fixtures.js";
import { test } from "vitest";
import fs from "node:fs";

import { resolveArchiveDir, runId, runDir, put, load, list, size } from "./archive.js";

test("benchmark transcripts share the writable Brain host results store", () => {
  const home = path.join(fixtureRoot(), ".otto");
  assert.equal(
    resolveArchiveDir({ OTTO_HOME: home }),
    path.join(home, "otto-brain", "results", "transcripts"),
  );
});

test("archives round-trip isolated host exchanges, preserve unusual task names and skip corruption", () => {
  const home = fs.mkdtempSync(path.join(fixtureRoot(), "brain-transcripts-"));
  const env = { OTTO_HOME: home };
  try {
    const stamp = new Date("2026-10-23T12:00:00Z");
    const id = runId(null, stamp);
    assert.notEqual(runId(null, stamp), id);
    const file = put(
      id,
      "__proto__",
      {
        request: { messages: ["private prompt"] },
        response: { answer: "saved" },
        meta: { turn: 1 },
      },
      env,
    );
    put(id, "task/a", { request: {}, response: {}, label: "second" }, env);
    fs.writeFileSync(path.join(runDir(id, env), "broken.json"), "{");
    fs.writeFileSync(path.join(runDir(id, env), "wrong-shape.json"), "null");
    const entries = load(id, env);
    assert.equal(Object.getPrototypeOf(entries), null);
    assert.equal(entries.__proto__[0].taskId, "__proto__");
    assert.deepEqual(entries.__proto__[0].request, { messages: ["private prompt"] });
    assert.equal(entries["task/a"][0].label, "second");
    assert.deepEqual(list(env), [id]);
    assert.ok(size(env) >= fs.statSync(file).size);
    assert.deepEqual(list({ OTTO_HOME: path.join(home, "other-host") }), []);
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("archive identities cannot escape their host store", () => {
  for (const id of ["", "..", "../outside", "a/b", "a\\b", "a".repeat(201)]) {
    assert.throws(() => runDir(id, { OTTO_HOME: fixtureRoot() }), /Invalid Brain archive id/u);
  }
});
