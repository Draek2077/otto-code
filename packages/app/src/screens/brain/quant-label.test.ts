import { describe, expect, test } from "vitest";

import { formatQuantLabel } from "./quant-label";

describe("formatQuantLabel", () => {
  test("removes the filename-only UD qualifier", () => {
    expect(formatQuantLabel("UD-Q4_K_XL")).toBe("Q4_K_XL");
    expect(formatQuantLabel("ud-IQ2_XS")).toBe("IQ2_XS");
  });

  test("keeps ordinary labels and empty values unchanged", () => {
    expect(formatQuantLabel("Q4_K_M")).toBe("Q4_K_M");
    expect(formatQuantLabel(null)).toBe("");
  });
});
