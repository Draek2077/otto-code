import { describe, expect, it } from "vitest";

import {
  describeRuntimeRemovalError,
  isRuntimeRemovalAccessDenied,
} from "./brain-runtime-removal.js";

describe("describeRuntimeRemovalError", () => {
  it("turns a Windows runtime-directory lock into an actionable recovery step", () => {
    expect(
      describeRuntimeRemovalError(
        "EPERM: operation not permitted, scandir 'C:\\otto-brain\\runtimes\\cuda'",
      ),
    ).toBe("Windows denied access to this runtime. You can retry with administrator permission.");
  });

  it("recognizes Windows access-denied variants", () => {
    expect(isRuntimeRemovalAccessDenied("EACCES: permission denied")).toBe(true);
    expect(isRuntimeRemovalAccessDenied("runtime is missing")).toBe(false);
  });

  it("preserves actionable failures from the runtime command", () => {
    expect(describeRuntimeRemovalError("managed runtime not found: cuda")).toBe(
      "managed runtime not found: cuda",
    );
  });
});
