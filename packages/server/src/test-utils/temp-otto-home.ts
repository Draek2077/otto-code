import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";

import { removeTempDir } from "./remove-temp-dir.js";

/**
 * Points `$OTTO_HOME` at a throwaway directory for the calling suite.
 *
 * Anything resolving through `resolveOttoHome()` - most visibly the materialized
 * provider images under `$OTTO_HOME/attachments` - otherwise reads and writes
 * the developer's real `~/.otto`, and a suite that cleans up after itself would
 * be deleting from it.
 *
 * Call at describe scope; returns a getter because the directory does not exist
 * until `beforeAll` runs.
 */
export function withTemporaryOttoHome(label = "otto-home-test"): () => string {
  const previous = process.env.OTTO_HOME;
  let ottoHome = "";

  beforeAll(() => {
    ottoHome = mkdtempSync(path.join(os.tmpdir(), `${label}-`));
    process.env.OTTO_HOME = ottoHome;
  });

  afterAll(() => {
    if (previous === undefined) {
      delete process.env.OTTO_HOME;
    } else {
      process.env.OTTO_HOME = previous;
    }
    if (ottoHome) {
      removeTempDir(ottoHome);
    }
  });

  return () => ottoHome;
}
