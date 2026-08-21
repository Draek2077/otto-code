import path from "node:path";
import assert from "node:assert/strict";
import os from "node:os";
import { test } from "vitest";

import { resolveArchiveDir } from "./archive.js";

test("benchmark transcripts share the writable Brain host results store", () => {
  const home = path.join(os.homedir(), ".otto");
  assert.equal(
    resolveArchiveDir({ OTTO_HOME: home }),
    path.join(home, "otto-brain", "results", "transcripts"),
  );
});
