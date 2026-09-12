import { readFile, writeFile, mkdir } from "node:fs/promises";

// Publisher build input only. Never ask an Otto end user for an app registration.
// The native registration ships with the daemon; end-user tokens never do.
const source = process.env.OTTO_GOOGLE_OAUTH_CLIENT_FILE;
if (source) {
  const registration = JSON.parse(await readFile(source, "utf8"));
  const client = registration.installed;
  if (!client?.client_id?.endsWith(".apps.googleusercontent.com") || !client?.client_secret) {
    throw new Error("Expected a Google Desktop app registration for the publisher build.");
  }
  const directory = new URL("../packages/server/dist/server/server/connectors/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL("google-oauth-client.json", directory),
    JSON.stringify({
      installed: { client_id: client.client_id, client_secret: client.client_secret },
    }),
    { mode: 0o600 },
  );
}
