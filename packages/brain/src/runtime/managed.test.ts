import { afterEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_LLAMA_BUILD,
  defaultRuntimeSpec,
  describeLoaderFailure,
  listManagedRuntimes,
  missingLibraryFrom,
  parseDeviceList,
  resolveRuntimeVariant,
  serverExeName,
  supportedVariants,
} from "./managed.js";
import { buildEnv } from "./args.js";
import type { Runtime } from "../types.js";

// Asset names read off llama.cpp release b10265. They are re-checked here
// rather than derived, because the naming scheme changed between tags: b4600
// shipped `win-cuda-cu12.4-x64`, b10265 ships `win-cuda-12.4-x64`.
const BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${DEFAULT_LLAMA_BUILD}`;

test("windows x64 with an NVIDIA GPU installs CUDA plus the cudart companion", () => {
  const spec = defaultRuntimeSpec(null, { platform: "win32", arch: "x64", hasNvidiaGpu: true });
  assert.equal(spec.variant, "cuda");
  assert.deepEqual(spec.assets, [
    `${BASE}/llama-${DEFAULT_LLAMA_BUILD}-bin-win-cuda-12.4-x64.zip`,
    // Not build-tagged upstream, but published under each release tag.
    `${BASE}/cudart-llama-bin-win-cuda-12.4-x64.zip`,
  ]);
});

test("windows x64 without an NVIDIA GPU falls back to Vulkan, one asset", () => {
  const spec = defaultRuntimeSpec(null, { platform: "win32", arch: "x64", hasNvidiaGpu: false });
  assert.equal(spec.variant, "vulkan");
  assert.deepEqual(spec.assets, [`${BASE}/llama-${DEFAULT_LLAMA_BUILD}-bin-win-vulkan-x64.zip`]);
});

test("macOS arm64 gets the Metal-enabled stock build as a tarball", () => {
  const spec = defaultRuntimeSpec(null, { platform: "darwin", arch: "arm64" });
  assert.equal(spec.variant, "metal");
  assert.deepEqual(spec.assets, [`${BASE}/llama-${DEFAULT_LLAMA_BUILD}-bin-macos-arm64.tar.gz`]);
});

test("macOS x64 is CPU-only", () => {
  const spec = defaultRuntimeSpec(null, { platform: "darwin", arch: "x64" });
  assert.equal(spec.variant, "cpu");
  assert.deepEqual(spec.assets, [`${BASE}/llama-${DEFAULT_LLAMA_BUILD}-bin-macos-x64.tar.gz`]);
});

// Vulkan is the Linux GPU default by measurement, not by absence: a CUDA container
// image exists upstream and benchmarked at 1.00x-1.04x of Vulkan on an RTX 5090 for
// 40x the download. `assetNames` must keep returning null for linux/cuda so the CLI
// reports it as unsupported rather than 404ing mid-download. See the managed.ts header.
test("linux GPU installs Vulkan, and cuda stays unavailable there", () => {
  const spec = defaultRuntimeSpec(null, { platform: "linux", arch: "x64", hasNvidiaGpu: true });
  assert.equal(spec.variant, "vulkan");
  assert.deepEqual(spec.assets, [
    `${BASE}/llama-${DEFAULT_LLAMA_BUILD}-bin-ubuntu-vulkan-x64.tar.gz`,
  ]);
  assert.ok(!supportedVariants("linux", "x64").includes("cuda"));
  assert.throws(
    () => defaultRuntimeSpec(null, { platform: "linux", arch: "x64", variant: "cuda" }),
    /publishes no cuda build for linux\/x64/,
  );
});

test("linux without a GPU takes the plain ubuntu build", () => {
  const spec = defaultRuntimeSpec(null, { platform: "linux", arch: "x64", hasNvidiaGpu: false });
  assert.equal(spec.variant, "cpu");
  assert.deepEqual(spec.assets, [`${BASE}/llama-${DEFAULT_LLAMA_BUILD}-bin-ubuntu-x64.tar.gz`]);
});

test("arm64 slices resolve on both linux and windows", () => {
  assert.deepEqual(defaultRuntimeSpec(null, { platform: "linux", arch: "arm64" }).assets, [
    `${BASE}/llama-${DEFAULT_LLAMA_BUILD}-bin-ubuntu-vulkan-arm64.tar.gz`,
  ]);
  assert.deepEqual(defaultRuntimeSpec(null, { platform: "win32", arch: "arm64" }).assets, [
    `${BASE}/llama-${DEFAULT_LLAMA_BUILD}-bin-win-cpu-arm64.zip`,
  ]);
});

test("an explicit --build tag replaces the pin in every URL", () => {
  const spec = defaultRuntimeSpec("b9999", { platform: "darwin", arch: "arm64" });
  assert.equal(spec.version, "b9999");
  assert.deepEqual(spec.assets, [
    "https://github.com/ggml-org/llama.cpp/releases/download/b9999/llama-b9999-bin-macos-arm64.tar.gz",
  ]);
});

test("an unsupported platform reports what it tried instead of guessing a URL", () => {
  assert.throws(
    () => defaultRuntimeSpec(null, { platform: "freebsd" as NodeJS.Platform, arch: "x64" }),
    /publishes no cpu build for freebsd\/x64/,
  );
  assert.deepEqual(supportedVariants("freebsd" as NodeJS.Platform, "x64"), []);
});

test("auto never picks an accelerator the platform has no asset for", () => {
  for (const platform of ["win32", "darwin", "linux"] as NodeJS.Platform[]) {
    for (const arch of ["x64", "arm64"]) {
      for (const hasNvidiaGpu of [true, false]) {
        const variant = resolveRuntimeVariant({ platform, arch, hasNvidiaGpu });
        assert.ok(
          supportedVariants(platform, arch).includes(variant),
          `${platform}/${arch} gpu=${hasNvidiaGpu} picked unsupported ${variant}`,
        );
      }
    }
  }
});

test("the binary name drops the .exe off Windows", () => {
  assert.equal(serverExeName("win32"), "llama-server.exe");
  assert.equal(serverExeName("darwin"), "llama-server");
  assert.equal(serverExeName("linux"), "llama-server");
});

test("buildEnv sets the loader variable each platform actually reads", () => {
  const runtime = { dir: "/rt", vendorDir: null } as unknown as Runtime;
  const base = { PATH: "/usr/bin" };

  const win = buildEnv({ ...runtime, dir: "C:\\rt" } as Runtime, { PATH: "C:\\Windows" }, "win32");
  assert.equal(win.PATH, "C:\\rt;C:\\Windows");
  assert.equal(win.LD_LIBRARY_PATH, undefined);
  assert.equal(win.DYLD_LIBRARY_PATH, undefined);

  const mac = buildEnv(runtime, base, "darwin");
  assert.equal(mac.DYLD_LIBRARY_PATH, "/rt:");
  assert.equal(mac.LD_LIBRARY_PATH, undefined);

  const linux = buildEnv(runtime, { ...base, LD_LIBRARY_PATH: "/opt/lib" }, "linux");
  assert.equal(linux.LD_LIBRARY_PATH, "/rt:/opt/lib");
  assert.equal(linux.PATH, "/rt:/usr/bin");
});

test("buildEnv keeps the vendor dir ahead of the inherited path", () => {
  const runtime = { dir: "C:\\rt", vendorDir: "C:\\vendor" } as unknown as Runtime;
  assert.equal(
    buildEnv(runtime, { PATH: "C:\\Windows" }, "win32").PATH,
    "C:\\rt;C:\\vendor;C:\\Windows",
  );
});

// Verbatim stderr from llama-b10236-bin-ubuntu-x64 on a stock Ubuntu 24.04 with
// no libgomp1: the archive extracts, then the binary exits 127. No upstream Linux
// asset ships libgomp, so this is the default outcome on a clean host.
const MISSING_LIBGOMP =
  "./llama-server: error while loading shared libraries: libgomp.so.1: " +
  "cannot open shared object file: No such file or directory\n";

test("a missing system library is reported with the package that provides it", () => {
  const message = describeLoaderFailure(MISSING_LIBGOMP, "/rt", "linux");
  assert.ok(message, "the loader failure must be recognised");
  assert.match(message, /libgomp\.so\.1 is missing/);
  assert.match(message, /libgomp1 \(Debian\/Ubuntu\)/, "names the package to install");
  assert.match(message, /\/rt/, "points at the runtime it just installed");
});

test("macOS dyld phrasing is recognised too", () => {
  const message = describeLoaderFailure(
    "dyld[512]: Library not loaded: @rpath/libomp.dylib\n  Referenced from: llama-server",
    "/rt",
    "darwin",
  );
  assert.match(String(message), /libomp\.dylib is missing/);
});

test("an unrecognised failure does not condemn a usable install", () => {
  // The guard that keeps a future non-zero `--version` from failing the install.
  assert.equal(describeLoaderFailure("some unrelated warning\n", "/rt", "linux"), null);
  assert.equal(describeLoaderFailure("", "/rt", "linux"), null);
});

test("the missing soname is lifted out of both loader dialects", () => {
  assert.equal(missingLibraryFrom(MISSING_LIBGOMP), "libgomp.so.1");
  assert.equal(
    missingLibraryFrom("dyld[1]: Library not loaded: @rpath/libomp.dylib"),
    "@rpath/libomp.dylib",
  );
  assert.equal(missingLibraryFrom("nothing to see"), null);
});

test("device parsing separates a real GPU from the empty list", () => {
  // Both captured from llama-server --list-devices at b10236.
  assert.deepEqual(
    parseDeviceList(
      "Available devices:\n  CUDA0: NVIDIA GeForce RTX 5090 Laptop GPU (24462 MiB, 23119 MiB free)\n",
    ),
    ["CUDA0: NVIDIA GeForce RTX 5090 Laptop GPU (24462 MiB, 23119 MiB free)"],
  );
  // The Vulkan asset on WSL2, which has no NVIDIA ICD. Empty means the install
  // would run on CPU, so the caller warns rather than reporting plain success.
  assert.deepEqual(parseDeviceList("Available devices:\n  (none)\n"), []);
  assert.deepEqual(parseDeviceList(""), []);
});

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("installed runtimes rank by accelerator, then newest build", () => {
  // Several variants can now sit side by side, so readdir order must not decide
  // which one `auto` picks: a CPU build installed for a test would outrank CUDA.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otto-brain-managed-"));
  temps.push(root);
  for (const name of [
    "cpu-managed-b10265",
    "cuda-12-4-managed-b10000",
    "vulkan-managed-b10265",
    "cuda-12-4-managed-b10265",
  ]) {
    const bin = path.join(root, name, "build", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "llama-server"), "");
  }

  assert.deepEqual(
    listManagedRuntimes(root, "linux").map((r) => r.label),
    [
      "cuda-12-4-managed-b10265",
      "cuda-12-4-managed-b10000",
      "vulkan-managed-b10265",
      "cpu-managed-b10265",
    ],
  );
});

test("a managed runtime is found through the tarball's nested build/bin layout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otto-brain-managed-"));
  temps.push(root);
  const bin = path.join(root, "metal-managed-b10265", "build", "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "llama-server"), "");

  const [runtime] = listManagedRuntimes(root, "linux");
  assert.equal(runtime.exe, path.join(bin, "llama-server"));
  assert.equal(runtime.dir, bin, "dir is where the shared libraries sit, not the slug root");
  assert.equal(runtime.version, "b10265");
  // The extensionless binary must not be picked up by a Windows-shaped scan.
  assert.deepEqual(listManagedRuntimes(root, "win32"), []);
});

test("managed runtime inventory preserves its human display name", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otto-brain-managed-"));
  temps.push(root);
  const runtimeRoot = path.join(root, "cuda-12-4-managed-b10265");
  const bin = path.join(runtimeRoot, "build", "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "llama-server"), "");
  fs.writeFileSync(
    path.join(runtimeRoot, ".otto-runtime.json"),
    JSON.stringify({ displayName: "CUDA 12.4 · b10265 (Otto managed)" }),
  );

  const [runtime] = listManagedRuntimes(root, "linux");
  assert.equal(runtime.displayName, "CUDA 12.4 · b10265 (Otto managed)");
});
