import { afterEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listRuntimes, resolveOverride } from "./lmstudio.js";

const temps: string[] = [];

function backends(layout: Record<string, string[]>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otto-brain-lms-"));
  temps.push(root);
  for (const [dir, files] of Object.entries(layout)) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(root, dir, file), "");
  }
  return root;
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("windows discovery pairs each runtime with its vendor dir and orders by accelerator", () => {
  const root = backends({
    "llama.cpp-win-x86_64-nvidia-cuda12-avx2-1.52.0": ["llama-server.exe"],
    "llama.cpp-win-x86_64-vulkan-avx2-1.50.0": ["llama-server.exe"],
    "llama.cpp-win-x86_64-avx2-1.49.0": ["llama-server.exe"],
    "vendor/win-llama-cuda12-vendor-v2": ["cudart64_12.dll"],
    "vendor/win-llama-vulkan-vendor-v2": ["vulkan-1.dll"],
  });

  const found = listRuntimes(root, "win32");
  assert.deepEqual(
    found.map((r) => r.label),
    ["CUDA 12", "Vulkan", "CPU (AVX2)"],
  );
  assert.equal(found[0].version, "1.52.0");
  assert.equal(found[0].vendorDir, path.join(root, "vendor", "win-llama-cuda12-vendor-v2"));
  assert.equal(found[2].vendorDir, null, "the AVX2 build is not a stub");
});

test("a windows runtime whose vendor dir is missing is skipped, not offered", () => {
  // The stub launches and dies with STATUS_DLL_NOT_FOUND printing nothing, so
  // offering it would look like an unexplained crash.
  const root = backends({
    "llama.cpp-win-x86_64-nvidia-cuda12-avx2-1.52.0": ["llama-server.exe"],
    "llama.cpp-win-x86_64-avx2-1.49.0": ["llama-server.exe"],
  });
  assert.deepEqual(
    listRuntimes(root, "win32").map((r) => r.label),
    ["CPU (AVX2)"],
  );
});

test("a CUDA directory is not offered a second time as an AVX2 build", () => {
  // Its name contains "avx2" too; only prefix matching keeps them distinct.
  const root = backends({
    "llama.cpp-win-x86_64-nvidia-cuda12-avx2-1.52.0": ["llama-server.exe"],
    "vendor/win-llama-cuda12-vendor-v2": ["cudart64_12.dll"],
  });
  assert.equal(listRuntimes(root, "win32").length, 1);
});

test("macOS discovery finds the extensionless binary and prefers Metal", () => {
  const root = backends({
    "llama.cpp-mac-arm64-apple-metal-advsimd-1.52.0": ["llama-server"],
    "llama.cpp-mac-x86_64-avx2-1.40.0": ["llama-server"],
  });
  const found = listRuntimes(root, "darwin");
  assert.deepEqual(
    found.map((r) => r.label),
    ["Metal", "CPU (x86_64)"],
  );
  assert.equal(
    found[0].exe,
    path.join(root, "llama.cpp-mac-arm64-apple-metal-advsimd-1.52.0", "llama-server"),
  );
  assert.equal(found[0].vendorDir, null);
});

test("linux discovery orders CUDA over Vulkan over CPU", () => {
  const root = backends({
    "llama.cpp-linux-x86_64-vulkan-avx2-1.51.0": ["llama-server"],
    "llama.cpp-linux-x86_64-nvidia-cuda12-avx2-1.52.0": ["llama-server"],
    "llama.cpp-linux-x86_64-avx2-1.49.0": ["llama-server"],
  });
  assert.deepEqual(
    listRuntimes(root, "linux").map((r) => r.label),
    ["CUDA 12", "Vulkan", "CPU (AVX2)"],
  );
});

test("an unrecognised directory name still resolves off Windows", () => {
  // LM Studio's naming has changed before. On the self-contained platforms a
  // directory holding a llama-server binary is usable whatever it is called.
  const root = backends({ "llama.cpp-some-future-name-2.0.0": ["llama-server"] });
  const found = listRuntimes(root, "linux");
  assert.equal(found.length, 1);
  assert.equal(found[0].version, "2.0.0");
});

test("the shape fallback does not apply on Windows", () => {
  const root = backends({ "llama.cpp-some-future-name-2.0.0": ["llama-server.exe"] });
  assert.deepEqual(listRuntimes(root, "win32"), []);
});

test("a directory without a server binary is never offered", () => {
  const root = backends({ "llama.cpp-linux-x86_64-avx2-1.49.0": ["README.md"] });
  assert.deepEqual(listRuntimes(root, "linux"), []);
});

test("a missing backends dir is empty, not an error", () => {
  assert.deepEqual(listRuntimes(path.join(os.tmpdir(), "otto-brain-absent-xyz"), "linux"), []);
});

test("an override resolves from either a directory or the binary itself", () => {
  const root = backends({ rt: ["llama-server"] });
  const dir = path.join(root, "rt");
  const exe = path.join(dir, "llama-server");

  assert.equal(resolveOverride(dir, "linux").exe, exe);
  // The extensionless binary path looks exactly like a directory path; only a
  // stat call tells them apart.
  assert.equal(resolveOverride(exe, "linux").exe, exe);
  assert.equal(resolveOverride(exe, "linux").dir, dir);
  assert.throws(() => resolveOverride(path.join(root, "nope"), "linux"), /llama-server not found/);
});
