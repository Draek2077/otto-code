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
  rowWidth: 700,
  isDeveloperMode: true,
  visualizerEnabled: true,
  voiceCuesAvailable: true,
  microphoneAvailable: true,
  hasWorkspaceScripts: true,
  hasWorkspaceDirectory: true,
  hasTeamChatButton: true,
  hasMeetingsButton: true,
  hasBrainButton: true,
};

// Listed in the strip's own left-to-right order, so a failing expectation reads
// as the row does.
function survivors(overrides: Partial<CompactHeaderActionsInput> = {}) {
  const fit = resolveCompactHeaderActions({ ...DEVELOPER_MOBILE, ...overrides });
  return [
    fit.showTeamChat ? "teamChat" : null,
    fit.showMeetings ? "meetings" : null,
    fit.showWakeWord ? "wakeWord" : null,
    fit.showVoiceCues ? "voiceCues" : null,
    fit.showVisualizer ? "visualizer" : null,
    fit.showPlay ? "play" : null,
    fit.showCompactExplorer ? "explorer" : null,
  ].filter((name): name is string => name !== null);
}

function menuFallbacks(overrides: Partial<CompactHeaderActionsInput> = {}) {
  const fit = resolveCompactHeaderActions({ ...DEVELOPER_MOBILE, ...overrides });
  return [
    fit.menuTeamChat ? "teamChat" : null,
    fit.menuMeetings ? "meetings" : null,
    fit.menuWakeWord ? "wakeWord" : null,
    fit.menuVoiceCues ? "voiceCues" : null,
    fit.menuVisualizer ? "visualizer" : null,
    fit.menuPlay ? "play" : null,
    fit.menuExplorer ? "explorer" : null,
  ].filter((name): name is string => name !== null);
}

const EVERYTHING = [
  "teamChat",
  "meetings",
  "wakeWord",
  "voiceCues",
  "visualizer",
  "play",
  "explorer",
];

describe("resolveCompactHeaderActions", () => {
  it("renders everything before the row has been measured", () => {
    expect(survivors({ rowWidth: 0 })).toEqual(EVERYTHING);
  });

  it("keeps every button on a wide row", () => {
    expect(survivors()).toEqual(EVERYTHING);
  });

  it("drops the optional buttons in order as the row narrows", () => {
    expect(survivors({ rowWidth: 600 })).toEqual([
      "teamChat",
      "meetings",
      "wakeWord",
      "visualizer",
      "play",
      "explorer",
    ]);
    expect(survivors({ rowWidth: 550 })).toEqual([
      "teamChat",
      "wakeWord",
      "visualizer",
      "play",
      "explorer",
    ]);
    expect(survivors({ rowWidth: 500 })).toEqual(["wakeWord", "visualizer", "play", "explorer"]);
    expect(survivors({ rowWidth: 450 })).toEqual(["wakeWord", "play", "explorer"]);
    expect(survivors({ rowWidth: 400 })).toEqual(["wakeWord", "explorer"]);
  });

  it("keeps Brain and Explorer, the only controls charged to fixed chrome", () => {
    expect(survivors({ rowWidth: 350 })).toEqual(["explorer"]);
  });

  it("spends nothing on a button that reports itself unavailable", () => {
    // Chat is gone entirely, so its width goes to the next control in line.
    expect(survivors({ rowWidth: 550, hasTeamChatButton: false })).toEqual([
      "meetings",
      "wakeWord",
      "visualizer",
      "play",
      "explorer",
    ]);
    expect(survivors({ rowWidth: 450, microphoneAvailable: false })).toEqual([
      "visualizer",
      "play",
      "explorer",
    ]);
  });

  // The cue mute is the one button whose loss costs nothing - the same switch
  // is in Agents settings - so it yields its slot to everything else.
  it("keeps the voice-cue mute off a crowded row even when the host supports it", () => {
    expect(survivors({ rowWidth: 600 })).not.toContain("voiceCues");
  });

  it("never shows the voice-cue mute on a host that cannot speak cues", () => {
    expect(survivors({ voiceCuesAvailable: false })).toEqual([
      "teamChat",
      "meetings",
      "wakeWord",
      "visualizer",
      "play",
      "explorer",
    ]);
  });

  it("leaves only the menu on an extremely narrow row", () => {
    expect(survivors({ rowWidth: 40 })).toEqual(["explorer"]);
    expect(survivors({ rowWidth: 1 })).toEqual(["explorer"]);
  });

  it("never shows a button the workspace did not request, however wide the row", () => {
    // A script-less workspace has no Play button to drop in the first place.
    expect(survivors({ hasWorkspaceScripts: false })).toEqual([
      "teamChat",
      "meetings",
      "wakeWord",
      "voiceCues",
      "visualizer",
      "explorer",
    ]);
    expect(survivors({ visualizerEnabled: false })).toEqual([
      "teamChat",
      "meetings",
      "wakeWord",
      "voiceCues",
      "play",
      "explorer",
    ]);
    // The microphone outlives the others, but only where one is available -
    // without it the last slot falls to Play, the next one up the order.
    expect(survivors({ microphoneAvailable: false, rowWidth: 400 })).toEqual(["play", "explorer"]);
  });

  it("never drops anything on desktop, however narrow the measurement", () => {
    const fit = resolveCompactHeaderActions({
      ...DEVELOPER_MOBILE,
      isCompact: false,
      rowWidth: 100,
    });
    expect(fit.showPlay).toBe(true);
    expect(fit.showVisualizer).toBe(true);
    expect(fit.showTeamChat).toBe(true);
    expect(fit.showMeetings).toBe(true);
    expect(fit.showWakeWord).toBe(true);
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
    expect(menuFallbacks({ rowWidth: 600 })).toEqual(["voiceCues"]);
    expect(menuFallbacks({ rowWidth: 550 })).toEqual(["meetings", "voiceCues"]);
    expect(menuFallbacks({ rowWidth: 500 })).toEqual(["teamChat", "meetings", "voiceCues"]);
    expect(menuFallbacks({ rowWidth: 400 })).toEqual([
      "teamChat",
      "meetings",
      "voiceCues",
      "visualizer",
      "play",
    ]);
    expect(menuFallbacks({ rowWidth: 350 })).toEqual([
      "teamChat",
      "meetings",
      "wakeWord",
      "voiceCues",
      "visualizer",
      "play",
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
    expect(menuFallbacks({ rowWidth: 350, hasWorkspaceScripts: false })).toEqual([
      "teamChat",
      "meetings",
      "wakeWord",
      "voiceCues",
      "visualizer",
    ]);
    expect(menuFallbacks({ rowWidth: 350, hasMeetingsButton: false })).toEqual([
      "teamChat",
      "wakeWord",
      "voiceCues",
      "visualizer",
      "play",
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
