import { describe, expect, it } from "vitest";
import { collectAppSettingsUpdates } from "./index";

// APP_SETTINGS_UPDATE_KEYS is the only thing that lets an AppSettings field
// through `useSettings()`. A field missing from it does not fail to compile and
// does not throw - the write is just silently dropped, which is exactly how
// toolCallDetailLevel shipped unreachable. These cases pin the routing.
describe("collectAppSettingsUpdates", () => {
  it("routes toolCallDetailLevel through to the AppSettings store", () => {
    expect(collectAppSettingsUpdates({ toolCallDetailLevel: "overview" })).toEqual({
      toolCallDetailLevel: "overview",
    });
    expect(collectAppSettingsUpdates({ toolCallDetailLevel: "detailed" })).toEqual({
      toolCallDetailLevel: "detailed",
    });
  });

  it("keeps routing the neighbouring appearance fields", () => {
    expect(
      collectAppSettingsUpdates({ autoExpandReasoning: true, toolCallDetailLevel: "overview" }),
    ).toEqual({ autoExpandReasoning: true, toolCallDetailLevel: "overview" });
  });

  it("drops fields the app store does not own", () => {
    // Desktop-owned; the caller handles it separately.
    expect(collectAppSettingsUpdates({ releaseChannel: "beta" })).toEqual({});
  });

  it("ignores keys left undefined", () => {
    expect(collectAppSettingsUpdates({ toolCallDetailLevel: undefined })).toEqual({});
  });
});
