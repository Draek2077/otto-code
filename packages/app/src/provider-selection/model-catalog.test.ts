import type { AgentModelDefinition } from "@otto-code/protocol/agent-types";
import { describe, expect, it } from "vitest";
import { filterSelectableModels, findModelByReference } from "./model-catalog";

describe("findModelByReference", () => {
  it("prefers an exact model id over another model's alias", () => {
    const models: AgentModelDefinition[] = [
      {
        provider: "claude",
        id: "canonical-model",
        label: "Canonical model",
        aliases: ["gateway-model"],
      },
      {
        provider: "claude",
        id: "gateway-model",
        label: "Exact gateway model",
      },
    ];

    expect(findModelByReference(models, "gateway-model")?.label).toBe("Exact gateway model");
  });
});

describe("filterSelectableModels", () => {
  it("hides host-hidden models without treating them as invalid references", () => {
    const visible: AgentModelDefinition = {
      provider: "otto-brain",
      id: "visible",
      label: "Visible",
    };
    const hidden: AgentModelDefinition = {
      provider: "otto-brain",
      id: "hidden",
      label: "Hidden",
      isVisible: false,
    };

    expect(filterSelectableModels([visible, hidden])).toEqual([visible]);
    expect(findModelByReference([visible, hidden], "hidden")).toEqual(hidden);
  });
});
