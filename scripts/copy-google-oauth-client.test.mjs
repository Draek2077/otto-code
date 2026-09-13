import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { load } from "js-yaml";
import { copyGoogleOAuthClient } from "./copy-google-oauth-client.mjs";

const registration = {
  installed: {
    client_id: "fixture.apps.googleusercontent.com",
    client_secret: "fixture-secret",
    project_id: "not-packaged",
  },
  access_token: "not-packaged",
};

async function fixture(t) {
  const scratch = new URL("../.tmp/", import.meta.url);
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(new URL("google-packaging-", scratch));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { pathToFileURL } = await import("node:url");
  const directory = new URL("./", pathToFileURL(`${root}/`));
  return { directory, target: new URL("google-oauth-client.json", directory) };
}

for (const input of ["file", "json"]) {
  test(`packages only desktop identity from ${input}`, async (t) => {
    const { directory, target } = await fixture(t);
    const source = new URL("source.json", directory);
    await writeFile(source, JSON.stringify(registration));
    const { fileURLToPath } = await import("node:url");
    const env =
      input === "file"
        ? { OTTO_GOOGLE_OAUTH_CLIENT_FILE: fileURLToPath(source) }
        : { OTTO_GOOGLE_OAUTH_CLIENT_JSON: JSON.stringify(registration) };
    await copyGoogleOAuthClient({ directory, env });
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), {
      installed: {
        client_id: registration.installed.client_id,
        client_secret: registration.installed.client_secret,
      },
    });
  });
}

test("unconfigured development builds remove stale publisher identity", async (t) => {
  const { directory, target } = await fixture(t);
  await writeFile(target, JSON.stringify(registration));
  await copyGoogleOAuthClient({ directory, env: {} });
  await assert.rejects(readFile(target), { code: "ENOENT" });
});

test("release builds reject missing registration even when a stale file exists", async (t) => {
  const { directory, target } = await fixture(t);
  await writeFile(target, JSON.stringify(registration));
  await assert.rejects(
    copyGoogleOAuthClient({ directory, env: { OTTO_REQUIRE_GOOGLE_OAUTH_CLIENT: "1" } }),
    /required for this release/,
  );
  await assert.rejects(readFile(target), { code: "ENOENT" });
});

test("invalid registrations fail without including their contents", async (t) => {
  const { directory } = await fixture(t);
  for (const value of [
    "fixture-secret invalid JSON",
    JSON.stringify({ web: registration.installed }),
    JSON.stringify({ installed: { client_id: 42, client_secret: "fixture-secret" } }),
  ]) {
    await assert.rejects(
      copyGoogleOAuthClient({ directory, env: { OTTO_GOOGLE_OAUTH_CLIENT_JSON: value } }),
      (error) => {
        assert.doesNotMatch(error.message, /fixture-secret/);
        return true;
      },
    );
  }
});

test("ambiguous publisher inputs fail instead of choosing an identity", async (t) => {
  const { directory } = await fixture(t);
  await assert.rejects(
    copyGoogleOAuthClient({
      directory,
      env: {
        OTTO_GOOGLE_OAUTH_CLIENT_FILE: "unused.json",
        OTTO_GOOGLE_OAUTH_CLIENT_JSON: JSON.stringify(registration),
      },
    }),
    /only one/,
  );
});

test("every desktop release build receives registration and enforces it before publishing", async () => {
  const workflow = load(
    await readFile(new URL("../.github/workflows/desktop-release.yml", import.meta.url), "utf8"),
  );
  const builds = Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.run?.includes("npm run build:desktop"));
  assert.equal(builds.length, 4);
  for (const step of builds) {
    assert.equal(
      step.env.OTTO_GOOGLE_OAUTH_CLIENT_JSON,
      "${{ secrets.OTTO_GOOGLE_OAUTH_CLIENT_JSON }}",
    );
    assert.equal(
      step.env.OTTO_REQUIRE_GOOGLE_OAUTH_CLIENT,
      "${{ env.SHOULD_PUBLISH == 'true' && '1' || '0' }}",
    );
  }
});
