import { describe, expect, it } from "vitest";
import type { SplitPane } from "@/stores/workspace-layout-actions";
import type { WorkspaceTab } from "@/stores/workspace-tabs-store";
import { deriveWorkspacePaneState } from "./workspace-pane-state";
import { hideDeveloperTabs, isDeveloperOnlyTabKind } from "./interface-mode-tabs";

function tab(tabId: string, target: WorkspaceTab["target"]): WorkspaceTab {
  return { tabId, target, createdAt: 0 };
}

const AGENT = tab("t-agent", { kind: "agent", agentId: "a1" });
const TERMINAL = tab("t-term", { kind: "terminal", terminalId: "term1" });
const FILE = tab("t-file", { kind: "file", path: "/x.ts" });
const BROWSER = tab("t-browser", { kind: "browser", browserId: "b1" });
const ARTIFACT = tab("t-artifact", { kind: "artifact", artifactId: "art1" });

const ALL = [AGENT, TERMINAL, FILE, BROWSER, ARTIFACT];

describe("isDeveloperOnlyTabKind", () => {
  it("flags terminal and file, nothing else", () => {
    expect(isDeveloperOnlyTabKind("terminal")).toBe(true);
    expect(isDeveloperOnlyTabKind("file")).toBe(true);
    expect(isDeveloperOnlyTabKind("agent")).toBe(false);
    expect(isDeveloperOnlyTabKind("browser")).toBe(false);
    expect(isDeveloperOnlyTabKind("artifact")).toBe(false);
    expect(isDeveloperOnlyTabKind("draft")).toBe(false);
    expect(isDeveloperOnlyTabKind("setup")).toBe(false);
    expect(isDeveloperOnlyTabKind("gitLog")).toBe(false);
  });
});

describe("hideDeveloperTabs", () => {
  it("returns the same array reference in Developer mode (no memo churn)", () => {
    expect(hideDeveloperTabs(ALL, true)).toBe(ALL);
  });

  it("drops terminal + file tabs in User mode, keeps the rest in order", () => {
    expect(hideDeveloperTabs(ALL, false)).toEqual([AGENT, BROWSER, ARTIFACT]);
  });
});

describe("focus fallback when the focused tab is filtered away", () => {
  const pane: SplitPane = {
    id: "pane1",
    tabIds: [AGENT.tabId, TERMINAL.tabId, BROWSER.tabId],
    focusedTabId: TERMINAL.tabId,
  };

  it("keeps the focused terminal active in Developer mode", () => {
    const state = deriveWorkspacePaneState({ pane, tabs: hideDeveloperTabs(ALL, true) });
    expect(state.activeTabId).toBe(TERMINAL.tabId);
  });

  it("falls back to the first surviving tab in User mode", () => {
    // The focused terminal is filtered out, so focus lands on the first
    // remaining pane tab (the agent) rather than dropping to nothing.
    const state = deriveWorkspacePaneState({ pane, tabs: hideDeveloperTabs(ALL, false) });
    expect(state.activeTabId).toBe(AGENT.tabId);
    expect(state.tabs.map((t) => t.descriptor.tabId)).toEqual([AGENT.tabId, BROWSER.tabId]);
  });
});
