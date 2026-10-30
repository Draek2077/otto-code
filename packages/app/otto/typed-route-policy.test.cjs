const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the installed patched handler with both path implementations. No Metro,
// app process, route declaration writes or dependency stubs for the path boundary.
function fixture(paths, root) {
  const files = new Set(["./index.tsx"]);
  const context = {
    keys: () => [...files],
    __add: (key) => files.add(key),
    __delete: (key) => files.delete(key),
  };
  const regenerated = [];
  const exports = {};
  const source = fs.readFileSync(require.resolve("expo-router/build/typed-routes/index"), "utf8");
  vm.runInNewContext(source, {
    exports,
    process: { env: { EXPO_ROUTER_APP_ROOT: root } },
    console,
    setTimeout,
    clearTimeout,
    require: (name) => {
      if (name === "node:path") return paths;
      if (name === "expo-router/_ctx-shared") return { EXPO_ROUTER_CTX_IGNORE: /\.tsx?$/ };
      if (name === "../testing-library/require-context-ponyfill") return () => context;
      if (name === "../matchers") return { isTypedRoute: (file) => /\.tsx?$/.test(file) };
      if (name === "./generate") return {};
      return require(name);
    },
  });
  const handle = exports.getWatchHandler("ignored", {
    ctx: context,
    regenerateFn: (...args) => regenerated.push(args),
  });
  return { files, regenerated, handle };
}

test("Windows Metro events outside the route root never grow typed routes", async () => {
  const f = fixture(path.win32, "C:\\repo\\packages\\app\\src\\app");
  for (const filePath of [
    "C:\\repo\\packages\\server\\new.ts",
    "C:\\repo\\packages\\app\\src\\otto\\new.tsx",
    "D:\\other\\new.tsx",
    "C:\\repo\\packages\\app\\src",
  ]) {
    await f.handle({ filePath, type: "add" });
  }
  assert.deepEqual([...f.files], ["./index.tsx"]);
  assert.equal(f.regenerated.length, 0);
});
test("Windows route add and delete use the same slash keys as initial enumeration", async () => {
  const f = fixture(path.win32, "C:\\repo\\app");
  await f.handle({ filePath: "C:\\repo\\app\\h\\index.tsx", type: "add" });
  assert.deepEqual([...f.files], ["./index.tsx", "./h/index.tsx"]);
  await f.handle({ filePath: "C:\\repo\\app\\h\\index.tsx", type: "delete" });
  assert.deepEqual([...f.files], ["./index.tsx"]);
  assert.equal(f.regenerated.length, 2);
});
test("POSIX route events retain inside/outside root ownership", async () => {
  const f = fixture(path.posix, "/repo/app");
  await f.handle({ filePath: "/repo/server/new.ts", type: "add" });
  await f.handle({ filePath: "/repo/app/h/index.tsx", type: "add" });
  assert.deepEqual([...f.files], ["./index.tsx", "./h/index.tsx"]);
  assert.equal(f.regenerated.length, 1);
});
