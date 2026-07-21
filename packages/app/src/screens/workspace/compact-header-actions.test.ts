import { describe, expect, it } from "vitest";
import {
  resolveCompactHeaderActions,
  type CompactHeaderActionsInput,
} from "@/screens/workspace/compact-header-actions";

const DEVELOPER_MOBILE: CompactHeaderActionsInput = {
  isCompact: true,
  rowWidth: 600,
  isDeveloperMode: true,
  visualizerEnabled: true,
  voiceCuesAvailable: true,
  hasWorkspaceScripts: true,
  hasWorkspaceDirectory: true,
};

function survivors(overrides: Partial<CompactHeaderActionsInput> = {}) {
  const fit = resolveCompactHeaderActions({ ...DEVELOPER_MOBILE, ...overrides });
  return [
    fit.showPlay ? "play" : null,
    fit.showVisualizer ? "visualizer" : null,
    fit.showCompactExplorer ? "explorer" : null,
    fit.showVoiceCues ? "voiceCues" : null,
  ].filter((name): name is string => name !== null);
}

describe("resolveCompactHeaderActions", () => {
  it("renders everything before the row has been measured", () => {
    expect(survivors({ rowWidth: 0 })).toEqual(["play", "visualizer", "explorer", "voiceCues"]);
  });

  it("keeps every button on a wide row", () => {
    expect(survivors()).toEqual(["play", "visualizer", "explorer", "voiceCues"]);
  });

  it("drops Voice cues first, then Visualizer, then Explorer, and keeps Play longest", () => {
    expect(survivors({ rowWidth: 420 })).toEqual(["play", "visualizer", "explorer"]);
    expect(survivors({ rowWidth: 380 })).toEqual(["play", "explorer"]);
    expect(survivors({ rowWidth: 320 })).toEqual(["play"]);
    expect(survivors({ rowWidth: 260 })).toEqual([]);
  });

  // The cue mute is the one button whose loss costs nothing — the same switch
  // is in Agents settings — so it yields its slot to everything else.
  it("keeps the voice-cue mute off a crowded row even when the host supports it", () => {
    expect(survivors({ rowWidth: 380 })).not.toContain("voiceCues");
    expect(
      survivors({ rowWidth: 380, hasWorkspaceScripts: false, visualizerEnabled: false }),
    ).toEqual(["explorer", "voiceCues"]);
  });

  it("never shows the voice-cue mute on a host that cannot speak cues", () => {
    expect(survivors({ voiceCuesAvailable: false })).toEqual(["play", "visualizer", "explorer"]);
  });

  it("leaves only the menu on an extremely narrow row", () => {
    expect(survivors({ rowWidth: 40 })).toEqual([]);
    expect(survivors({ rowWidth: 1 })).toEqual([]);
  });

  it("never shows a button the workspace did not request, however wide the row", () => {
    // A script-less workspace has no Play button to drop in the first place.
    expect(survivors({ hasWorkspaceScripts: false })).toEqual([
      "visualizer",
      "explorer",
      "voiceCues",
    ]);
    expect(survivors({ visualizerEnabled: false })).toEqual(["play", "explorer", "voiceCues"]);
    // Play outlives the others, but only where the workspace has scripts.
    expect(survivors({ hasWorkspaceScripts: false, rowWidth: 320 })).toEqual(["explorer"]);
  });

  it("never drops anything on desktop, however narrow the measurement", () => {
    const fit = resolveCompactHeaderActions({
      ...DEVELOPER_MOBILE,
      isCompact: false,
      rowWidth: 100,
    });
    expect(fit.showPlay).toBe(true);
    expect(fit.showVisualizer).toBe(true);
    expect(fit.showPlainExplorer).toBe(true);
    // The compact explorer mount site stays off — desktop uses its own toggle.
    expect(fit.showCompactExplorer).toBe(false);
  });

  it("keeps the user-mode explorer, which has no Play or Visualizer beside it", () => {
    const fit = resolveCompactHeaderActions({
      ...DEVELOPER_MOBILE,
      isDeveloperMode: false,
      rowWidth: 320,
    });
    expect(fit.showPlainExplorer).toBe(true);
    expect(fit.showPlay).toBe(false);
    expect(fit.showVisualizer).toBe(false);
  });

  it("hides the user-mode explorer when there is no workspace directory", () => {
    const fit = resolveCompactHeaderActions({
      ...DEVELOPER_MOBILE,
      isDeveloperMode: false,
      hasWorkspaceDirectory: false,
    });
    expect(fit.showPlainExplorer).toBe(false);
  });
});
