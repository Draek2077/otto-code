import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { materializeGoogleConnectors } from "../../packages/server/scripts/materialize-google-connectors.mjs";

test("ordinary development builds do not need publisher registration", () => {
  assert.equal(materializeGoogleConnectors({ env: {} }), false);
});
test("required release registration fails closed without exposing supplied bytes", () => {
  assert.throws(
    () => materializeGoogleConnectors({ env: { OTTO_REQUIRE_GOOGLE_OAUTH_CLIENT: "1" } }),
    /required/,
  );
  assert.throws(
    () =>
      materializeGoogleConnectors({
        env: { CI: "true", OTTO_GOOGLE_OAUTH_CLIENT_JSON: "private-invalid-input" },
      }),
    /contents were not logged/,
  );
});
test("registration cannot be materialized outside CI", () => {
  assert.throws(
    () => materializeGoogleConnectors({ env: { OTTO_GOOGLE_OAUTH_CLIENT_JSON: "fixture" } }),
    /only.*CI/,
  );
});
test("CI emits only the expected native registration into an isolated artifact fixture", () => {
  const scratch = fileURLToPath(new URL("../../.tmp/", import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const folder = mkdtempSync(path.join(scratch, "connectors-google-artifact-"));
  const destination = path.join(folder, "google", "google-oauth-client.json");
  const installed = {
    client_id: "fixture.apps.googleusercontent.com",
    client_secret: "fake-publisher-registration",
  };
  assert.equal(
    materializeGoogleConnectors({
      env: {
        CI: "true",
        OTTO_GOOGLE_OAUTH_CLIENT_JSON: JSON.stringify({ installed, unrelated: "ignored" }),
      },
      destination,
    }),
    true,
  );
  assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")), { installed });
  const fromFile = path.join(folder, "preserved-publisher-input.json");
  writeFileSync(fromFile, JSON.stringify({ installed }));
  assert.equal(
    materializeGoogleConnectors({
      env: { CI: "true", OTTO_GOOGLE_OAUTH_CLIENT_FILE: fromFile },
      destination,
    }),
    true,
  );
  assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")), { installed });
  assert.throws(
    () =>
      materializeGoogleConnectors({
        env: {
          CI: "true",
          OTTO_GOOGLE_OAUTH_CLIENT_FILE: fromFile,
          OTTO_GOOGLE_OAUTH_CLIENT_JSON: "conflicting-input",
        },
        destination,
      }),
    /only one/,
  );
});
