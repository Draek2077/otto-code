const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { metroResourcePolicy } = require("./metro-resource-policy.cjs");
const root = path.resolve(".tmp", "metro-policy-repo[1]");
const app = path.join(root, "packages", "app");
const original = /\.expo[\\/]types/;
const policy = metroResourcePolicy({
  root,
  app,
  platform: "win32",
  maxWorkers: 14,
  blockList: original,
});
/** @param {string} file */
const blocked = (file) => policy.blockList.some((pattern) => pattern.test(file));

test("bounds Windows worker pressure and preserves a smaller explicit budget", () => {
  assert.equal(policy.maxWorkers, 2);
  assert.equal(
    metroResourcePolicy({ root, app, platform: "win32", maxWorkers: 1, blockList: [] }).maxWorkers,
    1,
  );
  assert.equal(
    metroResourcePolicy({ root, app, platform: "linux", maxWorkers: 14, blockList: [] }).maxWorkers,
    14,
  );
});
test("preserves every upstream exclusion", () => {
  assert.equal(policy.blockList[0], original);
  assert.equal(blocked(path.join(app, ".expo", "types", "router.d.ts")), true);
  assert.equal(
    metroResourcePolicy({
      root,
      app,
      platform: "darwin",
      maxWorkers: 2,
      blockList: [original, /other/],
    }).blockList[1].source,
    "other",
  );
});
test("prunes runtime homes and generated duplicate trees at their directory boundary", () => {
  for (const relative of [
    ".tmp/source.js",
    "packages/desktop/.dev/otto-home/agents/session.json",
    "packages/app/test-results/trace/resources/chunk.js",
    "packages/server/coverage/result.json",
    "plugins/example/.tmp/package.json",
    "packages/app/dist/index.js",
  ]) {
    const file = path.join(root, relative);
    assert.equal(blocked(file), true, file);
    assert.equal(blocked(file.replaceAll("\\", "/")), true, file);
    assert.equal(blocked(file.replaceAll("/", "\\")), true, file);
  }
});
test("keeps live sources, dependency output, and sibling checkouts visible", () => {
  for (const relative of [
    "packages/app/src/app/index.tsx",
    "packages/plugin/dist/client/index.js",
    "packages/client/dist/index.js",
    "node_modules/pkg/dist/index.js",
    "packages/app/otto/metro-resource-policy.cjs",
    "packages/app/test-results-view.tsx",
  ]) {
    assert.equal(blocked(path.join(root, relative)), false, relative);
  }
  assert.equal(blocked(path.join(root + "-other", "packages/app/dist/index.js")), false);
});
