import { describe, expect, it } from "vitest";
import { activeBrainQuantJob, selectInitialBrainQuant } from "./brain-quant-selection";

describe("selectInitialBrainQuant", () => {
  it("prefers an installed alternate quant over the catalog default", () => {
    expect(
      selectInitialBrainQuant(
        [
          { quant: "Q4_K_M", installed: false },
          { quant: "Q5_K_M", installed: true },
        ],
        "Q4_K_M",
        null,
      ),
    ).toBe("Q5_K_M");
  });

  it("keeps an in-progress download selected", () => {
    expect(
      selectInitialBrainQuant(
        [
          { quant: "Q4_K_M", installed: true },
          { quant: "Q5_K_M", installed: false },
        ],
        "Q4_K_M",
        "Q5_K_M",
      ),
    ).toBe("Q5_K_M");
  });
});

describe("activeBrainQuantJob", () => {
  const q4Job = { kind: "pull", target: "owner/repo#Q4_K_M" };

  it("does not let a sibling quant's pull block a second download", () => {
    expect(activeBrainQuantJob([q4Job], "owner/repo", "Q5_K_M", null)).toBeUndefined();
  });

  it("finds a repo pull before the picker has selected its quant", () => {
    expect(activeBrainQuantJob([q4Job], "owner/repo", null, null)).toBe(q4Job);
  });
});
