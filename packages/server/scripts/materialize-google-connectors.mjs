// OTTO(connectors): publisher registration enters release artifacts from CI only.
// This module never fetches registration, reads a user's credentials, or prints it.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

function registrationFrom(source, json) {
  try {
    const raw = source ? readFileSync(source, "utf8") : json;
    if (typeof raw !== "string" || Buffer.byteLength(raw) > 16384) throw new Error("size");
    const installed = JSON.parse(raw)?.installed;
    if (
      typeof installed?.client_id !== "string" ||
      !installed.client_id.endsWith(".apps.googleusercontent.com") ||
      typeof installed.client_secret !== "string" ||
      !installed.client_secret.trim()
    )
      throw new Error("shape");
    return {
      installed: { client_id: installed.client_id, client_secret: installed.client_secret },
    };
  } catch {
    throw new Error(
      "The CI Google Connector registration is invalid. Its contents were not logged.",
    );
  }
}
export function materializeGoogleConnectors({
  env = process.env,
  destination = new URL(
    "../dist/server/services/otto/connectors/google/google-oauth-client.json",
    import.meta.url,
  ),
} = {}) {
  const source = env.OTTO_GOOGLE_OAUTH_CLIENT_FILE;
  const json = env.OTTO_GOOGLE_OAUTH_CLIENT_JSON;
  if (!source && !json) {
    if (env.OTTO_REQUIRE_GOOGLE_OAUTH_CLIENT === "1")
      throw new Error("Google Connector registration is required for this release artifact.");
    return false;
  }
  if (env.CI !== "true")
    throw new Error("Publisher Google Connector registration may only be materialized in CI.");
  if (source && json) throw new Error("Supply only one Google OAuth publisher registration input.");
  const registration = registrationFrom(source, json);
  const output = destination instanceof URL ? fileURLToPath(destination) : destination;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(registration), { mode: 0o600 });
  return true;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  materializeGoogleConnectors();
