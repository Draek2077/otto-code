import { describe, expect, it } from "vitest";
import { requireOptionalNativeModule } from "expo-modules-core";

describe("Expo web module resolution", () => {
  it("uses the web implementation when no native bridge is present", () => {
    expect(requireOptionalNativeModule("OttoUnregisteredBrowserProbe")).toBeNull();
  });
});
