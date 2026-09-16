import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { load } from "js-yaml";
import { RELEASE_PACKAGES, distTagFor, planPublish } from "./publish-release-packages.mjs";

test("stable versions publish to latest and prereleases to beta", () => {
  assert.equal(distTagFor("0.9.12"), "latest");
  assert.equal(distTagFor("0.9.13-beta.2"), "beta");
});

test("a rerun skips packages that already landed and keeps dependency order", () => {
  const landed = new Set(["@otto-code/highlight", "@otto-code/relay"]);
  const plan = planPublish({ version: "0.9.13", isPublished: (name) => landed.has(name) });
  assert.deepEqual(
    plan.map((step) => step.name),
    RELEASE_PACKAGES,
  );
  assert.deepEqual(
    plan.filter((step) => !step.skip).map((step) => step.name),
    RELEASE_PACKAGES.slice(2),
  );
});

test("every published package names this repository for npm trusted publishing", async () => {
  for (const name of RELEASE_PACKAGES) {
    const dir = name.replace("@otto-code/", "");
    const pkg = JSON.parse(
      await readFile(new URL(`../packages/${dir}/package.json`, import.meta.url), "utf8"),
    );
    assert.equal(pkg.name, name);
    assert.deepEqual(pkg.repository, {
      type: "git",
      url: "git+https://github.com/Draek2077/otto-code.git",
      directory: `packages/${dir}`,
    });
  }
});

test("the publish workflow uses trusted publishing and the Google registration secret", async () => {
  const workflow = load(
    await readFile(new URL("../.github/workflows/npm-publish.yml", import.meta.url), "utf8"),
  );
  const job = workflow.jobs.publish;
  assert.equal(job.permissions["id-token"], "write");
  assert.equal(job["runs-on"], "ubuntu-latest");
  const publish = job.steps.find((step) => step.run?.includes("publish-release-packages.mjs"));
  assert.equal(
    publish.env.OTTO_GOOGLE_OAUTH_CLIENT_JSON,
    "${{ secrets.OTTO_GOOGLE_OAUTH_CLIENT_JSON }}",
  );
  assert.equal(publish.env.OTTO_REQUIRE_GOOGLE_OAUTH_CLIENT, "1");
  assert.equal(publish.env.NODE_AUTH_TOKEN, undefined);
});
