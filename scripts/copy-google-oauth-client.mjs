import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Publisher build input only. Never ask an Otto end user for an app registration.
// The native registration ships with the daemon; end-user tokens never do.
export async function copyGoogleOAuthClient({
  env = process.env,
  directory = new URL("../packages/server/dist/server/server/connectors/", import.meta.url),
} = {}) {
  const target = new URL("google-oauth-client.json", directory);
  // An incremental build must not silently reuse a previous publisher's identity.
  await rm(target, { force: true });
  const source = env.OTTO_GOOGLE_OAUTH_CLIENT_FILE;
  const json = env.OTTO_GOOGLE_OAUTH_CLIENT_JSON;
  if (!source && !json) {
    if (env.OTTO_REQUIRE_GOOGLE_OAUTH_CLIENT === "1") {
      throw new Error(
        "Google sign-in registration is required for this release. Supply OTTO_GOOGLE_OAUTH_CLIENT_FILE or OTTO_GOOGLE_OAUTH_CLIENT_JSON.",
      );
    }
    return;
  }
  if (source && json) {
    throw new Error("Supply only one Google OAuth publisher registration input.");
  }
  let client;
  try {
    client = JSON.parse(source ? await readFile(source, "utf8") : json)?.installed;
  } catch {
    // JSON parser errors can quote the input, including the registration secret.
    throw new Error("Could not read the Google OAuth publisher registration.");
  }
  if (
    typeof client?.client_id !== "string" ||
    !client.client_id.endsWith(".apps.googleusercontent.com") ||
    typeof client?.client_secret !== "string" ||
    !client.client_secret.trim()
  ) {
    throw new Error("Expected a Google Desktop app registration for the publisher build.");
  }
  await mkdir(directory, { recursive: true });
  await writeFile(
    target,
    JSON.stringify({
      installed: { client_id: client.client_id, client_secret: client.client_secret },
    }),
    { mode: 0o600 },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await copyGoogleOAuthClient();
}
