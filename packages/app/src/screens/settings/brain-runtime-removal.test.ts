import { describe, expect, it } from "vitest";

import { describeRuntimeRemovalError } from "./brain-runtime-removal.js";

describe("describeRuntimeRemovalError", () => {
  it("turns a Windows runtime-directory lock into an actionable recovery step", () => {
    expect(
      describeRuntimeRemovalError(
        "EPERM: operation not permitted, scandir 'C:\\otto-brain\\runtimes\\cuda'",
      ),
    ).toBe(
      "Windows denied access to this runtime. Close anything using it or correct the folder permissions, then try again.",
    );
  });

  it("preserves actionable failures from the runtime command", () => {
    expect(describeRuntimeRemovalError("managed runtime not found: cuda")).toBe(
      "managed runtime not found: cuda",
    );
  });
});
