import { describe, expect, it } from "vitest";
import type { BrainHostStatus, BrainInventoryModel } from "@otto-code/protocol/messages";
import { brainModelLifecycleState } from "./model-lifecycle";

const model = { id: "model-b", state: "not-loaded" } as BrainInventoryModel;

describe("brainModelLifecycleState", () => {
  it("reads loading and loaded states from any resident process", () => {
    const status = {
      running: true,
      modelId: "model-a",
      state: "ready",
      residents: [
        { modelId: "model-a", state: "ready" },
        { modelId: "model-b", state: "starting" },
      ],
    } as BrainHostStatus;

    expect(brainModelLifecycleState(model, status)).toBe("loading");
    status.residents![1]!.state = "ready";
    expect(brainModelLifecycleState(model, status)).toBe("loaded");
  });

  it("treats absence from an authoritative resident snapshot as unloaded", () => {
    const status = {
      running: true,
      modelId: "model-a",
      state: "ready",
      residents: [{ modelId: "model-a", state: "ready" }],
    } as BrainHostStatus;

    expect(brainModelLifecycleState(model, status)).toBe("not-loaded");
  });

  it("keeps the legacy primary lifecycle fallback", () => {
    const status = { running: true, modelId: "model-b", state: "stopping" } as BrainHostStatus;
    expect(brainModelLifecycleState(model, status)).toBe("unloading");
  });
});
