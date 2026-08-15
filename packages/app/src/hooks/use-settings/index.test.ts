import { describe, expect, it } from "vitest";
import { collectAppSettingsUpdates } from "./update-routing";

// APP_SETTINGS_UPDATE_KEYS is the only thing that lets an AppSettings field
// through `useSettings()`. A field missing from it does not fail to compile and
// does not throw - the write is just silently dropped, which is exactly how
// toolCallDetailLevel shipped unreachable. These cases pin the routing.
describe("collectAppSettingsUpdates", () => {
  it("routes the all-pages Metrics footer preference to app settings", () => {
    expect(collectAppSettingsUpdates({ clientResourceBarAllPages: true })).toEqual({
      clientResourceBarAllPages: true,
    });
  });

  it("routes the chat metrics bar preference to app settings", () => {
    expect(collectAppSettingsUpdates({ chatMetricsBar: true })).toEqual({
      chatMetricsBar: true,
    });
  });

  it("routes toolCallDetailLevel through to the AppSettings store", () => {
    expect(collectAppSettingsUpdates({ toolCallDetailLevel: "overview" })).toEqual({
      toolCallDetailLevel: "overview",
    });
    expect(collectAppSettingsUpdates({ toolCallDetailLevel: "detailed" })).toEqual({
      toolCallDetailLevel: "detailed",
    });
  });

  it("routes shortcut overlay mode to app settings", () => {
    expect(collectAppSettingsUpdates({ shortcutOverlayMode: "on-screen" })).toEqual({
      shortcutOverlayMode: "on-screen",
    });
  });

  it("keeps routing the neighbouring appearance fields", () => {
    expect(
      collectAppSettingsUpdates({ autoExpandReasoning: true, toolCallDetailLevel: "overview" }),
    ).toEqual({ autoExpandReasoning: true, toolCallDetailLevel: "overview" });
  });

  it("routes Structural diff presentation preferences to app settings", () => {
    expect(
      collectAppSettingsUpdates({
        formattingDiffHighlights: false,
        structuralReplacementPresentation: "before-after",
      }),
    ).toEqual({
      formattingDiffHighlights: false,
      structuralReplacementPresentation: "before-after",
    });
  });

  it("routes the Hey Otto feature gate and listening pause independently", () => {
    expect(
      collectAppSettingsUpdates({
        wakeWordEnabled: true,
        wakeWordListeningPaused: true,
      }),
    ).toEqual({
      wakeWordEnabled: true,
      wakeWordListeningPaused: true,
    });
  });

  it("routes the meeting transcript delivery policy to app settings", () => {
    expect(collectAppSettingsUpdates({ meetingTranscriptDeliveryPolicy: "local_only" })).toEqual({
      meetingTranscriptDeliveryPolicy: "local_only",
    });
  });

  it("drops fields the app store does not own", () => {
    // Desktop-owned; the caller handles it separately.
    expect(collectAppSettingsUpdates({ releaseChannel: "beta" })).toEqual({});
  });

  it("ignores keys left undefined", () => {
    expect(collectAppSettingsUpdates({ toolCallDetailLevel: undefined })).toEqual({});
  });
});
