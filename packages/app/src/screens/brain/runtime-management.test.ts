import { describe, expect, it } from "vitest";
import {
  formatBrainRuntimeShortLabel,
  isBrainRuntimeManagementAvailable,
  resolveBrainHostRuntime,
} from "./runtime-management";

const available = {
  managementAllowed: true,
  hostConnected: true,
  brainStatusKnown: true,
  brainStatusError: false,
  brainPhase: "running" as const,
  runtimeListAnswered: true,
  runtimeListError: false,
};

describe("isBrainRuntimeManagementAvailable", () => {
  it("allows management when the host and runtime status are healthy", () => {
    expect(isBrainRuntimeManagementAvailable(available)).toBe(true);
  });

  it.each([
    ["the remote brain does not permit management", { managementAllowed: false }],
    ["the host is offline", { hostConnected: false }],
    ["brain status is unknown", { brainStatusKnown: false }],
    ["brain status failed", { brainPhase: "failed" as const }],
    ["brain status query failed", { brainStatusError: true }],
    ["runtime status is unknown", { runtimeListAnswered: false }],
    ["runtime status query failed", { runtimeListError: true }],
  ])("hides management when %s", (_reason, override) => {
    expect(isBrainRuntimeManagementAvailable({ ...available, ...override })).toBe(false);
  });
});

describe("resolveBrainHostRuntime", () => {
  it("keeps the runtime reported by the Brain host", () => {
    expect(resolveBrainHostRuntime("llama-cuda v b10264")).toBe("llama-cuda v b10264");
  });

  it.each([undefined, null, "", "not installed", " NOT INSTALLED "])(
    "does not treat %s as an installed runtime",
    (runtime) => {
      expect(resolveBrainHostRuntime(runtime)).toBeNull();
    },
  );
});

describe("formatBrainRuntimeShortLabel", () => {
  it.each([
    ["CUDA 12.4 · b10534 (Otto managed)", "CUDA 12.4 (b10534)"],
    ["Vulkan · b10265 (Otto managed)", "Vulkan (b10265)"],
  ])("compacts the managed label %s", (displayName, expected) => {
    expect(
      formatBrainRuntimeShortLabel({ label: "cuda-12-4-managed-b10534", displayName, version: "" }),
    ).toBe(expected);
  });

  it.each(["", "LM Studio llama.cpp (Windows)"])(
    "returns null for the non-managed displayName %s",
    (displayName) => {
      expect(formatBrainRuntimeShortLabel({ label: "custom", displayName, version: "b1" })).toBe(
        null,
      );
    },
  );
});
