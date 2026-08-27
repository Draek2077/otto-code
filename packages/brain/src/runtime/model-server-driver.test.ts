import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { test } from "vitest";

import { llamaCppRuntimeDriver } from "./model-server-driver.js";
import type { Profile } from "../config/schema.js";
import type { Model, Runtime } from "../types.js";

test("llama.cpp driver owns its native launch, probe, and log adapter", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "otto-brain-driver-"));
  try {
    const runtime = {
      label: "managed-v1",
      version: "b1",
      dir: "/runtime",
      exe: "/runtime/llama-server",
      vendorDir: null,
      source: "managed",
    } satisfies Runtime;
    const model = {
      id: "model",
      displayName: "Model",
      modelPath: "/models/model.gguf",
      mmprojPath: null,
      mmprojBytes: 0,
      quant: null,
      sizeBytes: 0,
      features: { mtp: false, imatrix: false, distilled: false },
      metadata: null,
    } satisfies Model;
    const profile = {
      contextSize: 8192,
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      flashAttention: true,
      gpuLayers: 999,
      vision: false,
      reasoningBudget: 0,
      parallelSlots: 1,
      extraArgs: [],
    } as Profile;

    const launch = llamaCppRuntimeDriver.createLaunch({
      runtime,
      model,
      profile,
      calibration: null,
      paths: { root } as Parameters<typeof llamaCppRuntimeDriver.createLaunch>[0]["paths"],
      host: "127.0.0.1",
      port: 20800,
      logVerbosity: 3,
    });

    assert.equal(launch.executable, runtime.exe);
    assert.equal(launch.readinessPath, "/health");
    assert.equal(launch.propertiesPath, "/props");
    assert.ok(launch.args.includes("--slot-save-path"));
    assert.equal(launch.formatLogLine("ready"), "[llama-server] ready");
    assert.equal(
      llamaCppRuntimeDriver.describeProcessExit({ code: 3221225781, signal: null }),
      "llama-server exited with code 3221225781 (missing runtime DLLs - the vendor directory was not on PATH)",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
