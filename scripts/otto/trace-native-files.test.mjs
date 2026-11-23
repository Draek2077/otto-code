import assert from "node:assert/strict";
import { test } from "node:test";
import { includeTracedNativeFile } from "./trace-native-files.mjs";

const musl = "node_modules/@electron-internal/extract-zip/index.linux-x64-musl.node";
const glibc = { platform: "linux", glibcVersion: "2.40" };
test("glibc output omits only extract-zip's unreachable musl native variant", () => {
  assert.equal(includeTracedNativeFile(musl, glibc), false);
  assert.equal(includeTracedNativeFile(musl.replace("-musl", "-gnu"), glibc), true);
  assert.equal(
    includeTracedNativeFile("node_modules/@electron-internal/extract-zip/binding.js", glibc),
    true,
  );
});
test("real musl, unknown libc and Darwin retain their original inputs", () => {
  assert.equal(includeTracedNativeFile(musl, { platform: "linux" }), true);
  assert.equal(includeTracedNativeFile(musl, { platform: "darwin", glibcVersion: "2.40" }), true);
});
test("unrelated native dependencies are never hidden from auto-patchelf", () => {
  assert.equal(
    includeTracedNativeFile("node_modules/other/index.linux-x64-musl.node", glibc),
    true,
  );
  assert.equal(
    includeTracedNativeFile(musl.replace("extract-zip/", "extract-zip-fork/"), glibc),
    true,
  );
});
