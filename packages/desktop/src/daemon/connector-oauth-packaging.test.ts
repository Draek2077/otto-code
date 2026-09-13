import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPackage } from "@electron/asar";
import { afterEach, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { verifyBundledConnectorOAuth } = require("../../scripts/after-pack.js") as {
  verifyBundledConnectorOAuth: (
    appOutDir: string,
    platform: string,
    projectDir: string,
    requireGoogle?: boolean,
  ) => void;
};
const temporaryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.tmp");
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(
  platform: string,
  change?: { file: string; content?: string },
  includeGoogle = true,
) {
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "connector-packaging-"));
  directories.push(directory);
  const projectDir = join(directory, "packages/desktop");
  const compiled = join(directory, "packages/server/dist/server/server/connectors");
  const archiveSource = join(directory, "archive-source");
  const archived = join(
    archiveSource,
    "node_modules/@otto-code/server/dist/server/server/connectors",
  );
  const appOutDir = join(directory, "app-out");
  const resources = join(
    appOutDir,
    platform === "darwin" ? "Otto.app/Contents/Resources" : "resources",
  );
  for (const folder of [compiled, archived, resources]) await mkdir(folder, { recursive: true });
  for (const file of [
    "connector-oauth.js",
    "connector-oauth-registration.js",
    "google-connector-authorization.js",
    ...(includeGoogle ? ["google-oauth-client.json"] : []),
  ]) {
    const content = `export const buildIdentity = ${JSON.stringify(file)};`;
    await writeFile(join(compiled, file), content);
    if (change?.file === file) {
      if (change.content !== undefined) await writeFile(join(archived, file), change.content);
    } else {
      await writeFile(join(archived, file), content);
    }
  }
  await createPackage(archiveSource, join(resources, "app.asar"));
  return { appOutDir, projectDir };
}

test.each(["win32", "linux", "darwin"])(
  "verifies the real %s archive contents",
  async (platform) => {
    const { appOutDir, projectDir } = await fixture(platform);
    expect(() => verifyBundledConnectorOAuth(appOutDir, platform, projectDir)).not.toThrow();
  },
);

test.each([
  "connector-oauth.js",
  "connector-oauth-registration.js",
  "google-connector-authorization.js",
  "google-oauth-client.json",
])("rejects an archive missing %s", async (file) => {
  const { appOutDir, projectDir } = await fixture("win32", { file });
  expect(() => verifyBundledConnectorOAuth(appOutDir, "win32", projectDir)).toThrow(
    "runtime is missing",
  );
});

test("rejects a stale Google registration in the archive", async () => {
  const { appOutDir, projectDir } = await fixture("win32", {
    file: "google-oauth-client.json",
    content: "old publisher registration",
  });
  expect(() => verifyBundledConnectorOAuth(appOutDir, "win32", projectDir)).toThrow(
    "stale or empty",
  );
});

test("requires Google registration for publishing but permits an unconfigured development build", async () => {
  const { appOutDir, projectDir } = await fixture("win32", undefined, false);
  expect(() => verifyBundledConnectorOAuth(appOutDir, "win32", projectDir, false)).not.toThrow();
  expect(() => verifyBundledConnectorOAuth(appOutDir, "win32", projectDir, true)).toThrow(
    "Google sign-in registration is required",
  );
});

test("rejects a leftover Google registration in an unconfigured archive", async () => {
  const { appOutDir, projectDir } = await fixture("win32");
  await rm(resolve(projectDir, "../server/dist/server/server/connectors/google-oauth-client.json"));
  expect(() => verifyBundledConnectorOAuth(appOutDir, "win32", projectDir, false)).toThrow(
    "unexpected for this unconfigured build",
  );
});

test.each(["", "export const oldBuild = true;"])(
  "rejects empty or stale compiled registration: %j",
  async (content) => {
    const { appOutDir, projectDir } = await fixture("win32", {
      file: "connector-oauth-registration.js",
      content,
    });
    expect(() => verifyBundledConnectorOAuth(appOutDir, "win32", projectDir)).toThrow(
      "runtime is stale or empty",
    );
  },
);
