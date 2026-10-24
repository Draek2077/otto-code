import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  RELEASE_PACKAGES,
  RELEASE_WORKSPACES,
  distTagFor,
  packedFilename,
  planPublish,
} from "./publish-release-packages.mjs";

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("stable versions publish to latest and prereleases to beta", () => {
  assert.equal(distTagFor("0.10.0"), "latest");
  assert.equal(distTagFor("0.10.1-beta.2"), "beta");
});

test("Otto publishes its packages including standalone Brain under its npm scope", () => {
  assert.deepEqual(RELEASE_PACKAGES, [
    "@otto-code/highlight",
    "@otto-code/relay",
    "@otto-code/protocol",
    "@otto-code/client",
    "@otto-code/brain",
    "@otto-code/plugin",
    "@otto-code/server",
    "@otto-code/cli",
  ]);
});

test("a rerun skips packages that already landed and keeps dependency order", () => {
  const landed = new Set(["@otto-code/highlight", "@otto-code/relay"]);
  const plan = planPublish({ version: "0.10.0", isPublished: (name) => landed.has(name) });
  assert.deepEqual(
    plan.map((step) => step.name),
    RELEASE_PACKAGES,
  );
  assert.deepEqual(
    plan.filter((step) => !step.skip).map((step) => step.name),
    RELEASE_PACKAGES.slice(2),
  );
});

test("every published workspace exists, is public, and depends only on published workspaces", async () => {
  const published = new Set(RELEASE_WORKSPACES.map(({ workspace }) => workspace));
  for (const { workspace, directory } of RELEASE_WORKSPACES) {
    const pkg = JSON.parse(await read(`${directory}/package.json`));
    assert.equal(pkg.name, workspace);
    assert.notEqual(pkg.private, true, workspace);
    for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
      if (dependency.startsWith("@getpaseo/")) {
        assert.ok(published.has(dependency), `${workspace} depends on unpublished ${dependency}`);
        assert.ok(
          RELEASE_WORKSPACES.findIndex((entry) => entry.workspace === dependency) <
            RELEASE_WORKSPACES.findIndex((entry) => entry.workspace === workspace),
          `${dependency} must publish before ${workspace}`,
        );
      }
    }
  }
});

test("npm pack tarball names are reduced to a file name", () => {
  assert.equal(
    packedFilename('[{"filename":"getpaseo-cli-0.10.0.tgz"}]'),
    "getpaseo-cli-0.10.0.tgz",
  );
  assert.equal(
    packedFilename('[{"filename":"@otto-code/cli-0.10.0.tgz"}]'),
    "otto-code-cli-0.10.0.tgz",
  );
});

test("npm pack lifecycle output cannot hide the final tarball result", () => {
  assert.equal(
    packedFilename(
      'generated validators\n[build] ready\n[\n  {"filename":"getpaseo-protocol-0.10.0.tgz"}\n]\n',
    ),
    "getpaseo-protocol-0.10.0.tgz",
  );
});

test("the publish workflow uses trusted publishing, not a token", async () => {
  const workflow = await read(".github/workflows/npm-publish.yml");
  assert.match(workflow, /^\s+id-token: write$/m);
  assert.match(workflow, /run: node scripts\/publish-release-packages\.mjs$/m);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);
  assert.match(workflow, /tags:\s*\n\s+- "v\*"/);
});
