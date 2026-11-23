import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const {
  verifyWakeWordResources,
} = require("../../packages/desktop/scripts/otto/verify-wake-word.js");
test("the offline model subset and pinned Android runtime match their original distribution", () => {
  const audio = path.join(root, "packages/expo-two-way-audio");
  verifyWakeWordResources(path.join(audio, "models"));
  const manifest = JSON.parse(fs.readFileSync(path.join(audio, "wake-word-model.json"), "utf8"));
  const runtime = fs.readFileSync(path.join(audio, manifest.androidRuntime.file));
  assert.equal(runtime.length, manifest.androidRuntime.bytes);
  assert.equal(
    crypto.createHash("sha256").update(runtime).digest("hex"),
    manifest.androidRuntime.sha256,
  );
  assert.ok(
    fs
      .readFileSync(path.join(audio, "models/wake-word/LICENSE-APACHE-2.0.txt"), "utf8")
      .includes("Apache License"),
  );
});
for (const defect of ["missing", "corrupt"]) {
  test(`installer verification refuses a ${defect} detector asset`, () => {
    const scratch = path.join(root, ".tmp");
    fs.mkdirSync(scratch, { recursive: true });
    const temporary = fs.mkdtempSync(path.join(scratch, "wake-integrity-"));
    const directory = path.join(temporary, "wake-word");
    fs.mkdirSync(directory);
    const bytes = Buffer.from("pinned fixture");
    const manifest = {
      assets: { keywords: "keywords.txt" },
      assetBytes: { "keywords.txt": bytes.length },
      assetSha256: { "keywords.txt": crypto.createHash("sha256").update(bytes).digest("hex") },
    };
    fs.writeFileSync(path.join(directory, "model.json"), JSON.stringify(manifest));
    if (defect === "corrupt") fs.writeFileSync(path.join(directory, "keywords.txt"), "corrupt");
    try {
      assert.throws(() => verifyWakeWordResources(temporary));
    } finally {
      // Exact fixture paths only; never recursive cleanup or installed-home access.
      if (defect === "corrupt") fs.unlinkSync(path.join(directory, "keywords.txt"));
      fs.unlinkSync(path.join(directory, "model.json"));
      fs.rmdirSync(directory);
      fs.rmdirSync(temporary);
    }
  });
}
