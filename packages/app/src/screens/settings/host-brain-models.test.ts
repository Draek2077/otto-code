import { describe, expect, it } from "vitest";

import type { BrainRuntime } from "@otto-code/protocol/messages";

import { resolveHostSelectedBrainRuntime } from "../brain/runtime-management";

const runtimes: BrainRuntime[] = [
  {
    label: "cuda-12-4-managed-b10265",
    displayName: "CUDA 12.4 · b10265 (Otto managed)",
    version: "b10265",
    source: "managed",
    dir: "/remote/otto-brain/runtimes/cuda-12-4-managed-b10265",
  },
];

describe("resolveHostSelectedBrainRuntime", () => {
  it("matches the runtime identity supplied by the Brain host", () => {
    expect(resolveHostSelectedBrainRuntime(runtimes, "CUDA 12.4 (managed) vb10265")).toBe(
      runtimes[0],
    );
  });

  it("does not substitute the proxy daemon's configured runtime", () => {
    expect(resolveHostSelectedBrainRuntime(runtimes, "not installed")).toBeNull();
  });
});
