import { describe, expect, it } from "vitest";
import {
  resolveCompactHeaderActions,
  type CompactHeaderActionsInput,
} from "@/screens/workspace/compact-header-actions";

// Compact always carries the pinned Brain light (the sidebar is an overlay
// there), so the fixture does too - a compact input with `hasBrainButton: false`
// cannot happen, and a table calibrated against one would lie about the widths.
const DEVELOPER_MOBILE: CompactHeaderActionsInput = {
  isCompact: true,
  rowWidth: 600,
  isDeveloperMode: true,
  visualizerEnabled: true,
  voiceCuesAvailable: true,
  hasWorkspaceScripts: true,
  hasWorkspaceDirectory: true,
  hasBrainButton: true,
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

function menuFallbacks(overrides: Partial<CompactHeaderActionsInput> = {}) {
  const fit = resolveCompactHeaderActions({ ...DEVELOPER_MOBILE, ...overrides });
  return [
    fit.menuPlay ? "play" : null,
    fit.menuVisualizer ? "visualizer" : null,
    fit.menuExplorer ? "explorer" : null,
    fit.menuVoiceCues ? "voiceCues" : null,
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
    expect(survivors({ rowWidth: 474 })).toEqual(["play", "visualizer", "explorer"]);
    expect(survivors({ rowWidth: 434 })).toEqual(["play", "explorer"]);
    expect(survivors({ rowWidth: 374 })).toEqual(["play"]);
    expect(survivors({ rowWidth: 314 })).toEqual([]);
  });

  // Brain is pinned, so it is charged to fixed chrome instead of competing for
  // a slot: the same row width fits exactly one more droppable button without
  // it. It is never a menu fallback either - see workspace-brain-button.tsx.
  it("charges the pinned Brain light one slot's worth of the row budget", () => {
    expect(survivors({ rowWidth: 434, hasBrainButton: false })).toEqual([
      "play",
      "visualizer",
      "explorer",
    ]);
    expect(survivors({ rowWidth: 434 })).toEqual(["play", "explorer"]);
    expect(menuFallbacks({ rowWidth: 434, hasBrainButton: false })).toEqual(["voiceCues"]);
  });

  // The cue mute is the one button whose loss costs nothing - the same switch
  // is in Agents settings - so it yields its slot to everything else.
  it("keeps the voice-cue mute off a crowded row even when the host supports it", () => {
    expect(survivors({ rowWidth: 434 })).not.toContain("voiceCues");
    expect(
      survivors({ rowWidth: 434, hasWorkspaceScripts: false, visualizerEnabled: false }),
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
    expect(survivors({ hasWorkspaceScripts: false, rowWidth: 374 })).toEqual(["explorer"]);
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
    // The compact explorer mount site stays off - desktop uses its own toggle.
    expect(fit.showCompactExplorer).toBe(false);
  });

  it("keeps the user-mode explorer, which has no Play or Visualizer beside it", () => {
    const fit = resolveCompactHeaderActions({
      ...DEVELOPER_MOBILE,
      isDeveloperMode: false,
      rowWidth: 374,
    });
    expect(fit.showPlainExplorer).toBe(true);
    expect(fit.showPlay).toBe(false);
    expect(fit.showVisualizer).toBe(false);
  });

  it("moves every dropped button into the menu instead of losing it", () => {
    expect(menuFallbacks({ rowWidth: 474 })).toEqual(["voiceCues"]);
    expect(menuFallbacks({ rowWidth: 434 })).toEqual(["visualizer", "voiceCues"]);
    expect(menuFallbacks({ rowWidth: 374 })).toEqual(["visualizer", "explorer", "voiceCues"]);
    expect(menuFallbacks({ rowWidth: 314 })).toEqual([
      "play",
      "visualizer",
      "explorer",
      "voiceCues",
    ]);
  });

  it("offers no menu fallback while every button still fits", () => {
    expect(menuFallbacks()).toEqual([]);
    expect(menuFallbacks({ rowWidth: 0 })).toEqual([]);
  });

  it("offers no menu fallback on desktop, however narrow the measurement", () => {
    expect(menuFallbacks({ isCompact: false, rowWidth: 100 })).toEqual([]);
  });

  it("offers no menu fallback for an action the workspace did not request", () => {
    expect(menuFallbacks({ rowWidth: 314, hasWorkspaceScripts: false })).toEqual([
      "visualizer",
      "explorer",
      "voiceCues",
    ]);
    expect(menuFallbacks({ rowWidth: 314, visualizerEnabled: false })).toEqual([
      "play",
      "explorer",
      "voiceCues",
    ]);
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
