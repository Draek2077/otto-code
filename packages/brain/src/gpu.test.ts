import assert from "node:assert/strict";
import { test } from "vitest";

import { parseMetalDevice } from "./gpu.js";

test("Metal device reports a working-set budget without invented live usage", () => {
  const gpu = parseMetalDevice(["Metal: Apple M4 (21845 MiB, 21844 MiB free)"]);
  assert.equal(gpu?.name, "Apple M4");
  assert.equal(gpu?.totalBytes, 21845 * 1024 ** 2);
  assert.equal(gpu?.usedBytes, null);
  assert.equal(gpu?.freeBytes, null);
  assert.equal(parseMetalDevice(["CUDA0: NVIDIA GPU (24000 MiB, 22000 MiB free)"]), null);
});
