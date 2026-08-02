import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { expect } from "vitest";

// Load package-local .env.test first for integration/E2E credentials, then repo-root .env fallback.
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.resolve(serverRoot, ".env.test"), override: true });
dotenv.config({ path: path.resolve(serverRoot, "../.env") });

process.env.OTTO_SUPERVISED = "0";
process.env.GIT_TERMINAL_PROMPT = "0";
process.env.GIT_SSH_COMMAND = "ssh -oBatchMode=yes";
process.env.SSH_ASKPASS = "/usr/bin/false";
process.env.SSH_ASKPASS_REQUIRE = "force";
process.env.DISPLAY = process.env.DISPLAY ?? "1";

// DIAG(windows-fork-crash): ties each pool fork's pid to the test file it is
// about to run, so a fork that dies without an exit record can be traced back
// to a file. See scripts/vitest-kill-diag.cjs for the rest of the ledger.
if (process.env.OTTO_KILL_DIAG_FILE) {
  try {
    appendFileSync(
      process.env.OTTO_KILL_DIAG_FILE,
      `${JSON.stringify({
        t: Date.now(),
        pid: process.pid,
        ev: "file",
        path: expect.getState().testPath,
      })}\n`,
    );
  } catch {
    // Diagnostics must never break the run.
  }
}
