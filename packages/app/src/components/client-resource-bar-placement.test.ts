import { describe, expect, it } from "vitest";
import { resolveClientResourceBarPlacement } from "./client-resource-bar-placement";

describe("resolveClientResourceBarPlacement", () => {
  it("keeps the resource bar on the Metrics page by default", () => {
    expect(resolveClientResourceBarPlacement(false, true)).toBe("metrics-page");
  });

  it("moves the resource bar to the app shell when all-pages display is enabled", () => {
    expect(resolveClientResourceBarPlacement(true, true)).toBe("app-shell");
  });

  it("hides the resource bar when performance monitoring is disabled", () => {
    expect(resolveClientResourceBarPlacement(true, false)).toBe("hidden");
  });
});
