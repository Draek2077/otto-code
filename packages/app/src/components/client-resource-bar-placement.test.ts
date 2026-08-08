import { describe, expect, it } from "vitest";
import { resolveClientResourceBarPlacement } from "./client-resource-bar-placement";

describe("resolveClientResourceBarPlacement", () => {
  it("keeps the resource bar on the Metrics page by default", () => {
    expect(resolveClientResourceBarPlacement(false)).toBe("metrics-page");
  });

  it("moves the resource bar to the app shell when all-pages display is enabled", () => {
    expect(resolveClientResourceBarPlacement(true)).toBe("app-shell");
  });
});
