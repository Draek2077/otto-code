import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { DEFAULT_APP_SETTINGS } from "@/hooks/use-settings";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  openPreferredWorkspaceTarget,
  usesChatPanelOpenPreference,
} from "@/workspace-tabs/open-beside";

const WORKSPACE_KEY = "server-1:workspace-1";

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
});

describe("usesChatPanelOpenPreference", () => {
  const chatTargets = [
    { kind: "agent", agentId: "agent-1" },
    { kind: "draft", draftId: "draft-1" },
    { kind: "provider_subagent", parentAgentId: "agent-1", subagentId: "subagent-1" },
  ] as const;

  it.each(chatTargets)("routes a non-chat panel opened from $kind", (sourceTarget) => {
    expect(
      usesChatPanelOpenPreference(sourceTarget, { kind: "file", path: "/repo/README.md" }),
    ).toBe(true);
  });

  it("keeps chats and the empty launcher in normal tab placement", () => {
    const source = { kind: "agent", agentId: "agent-1" } as const;
    expect(usesChatPanelOpenPreference(source, { kind: "agent", agentId: "agent-2" })).toBe(false);
    expect(usesChatPanelOpenPreference(source, { kind: "new_tab" })).toBe(false);
  });

  it("does not apply the chat preference to panels opened from another panel", () => {
    expect(
      usesChatPanelOpenPreference(
        { kind: "file", path: "/repo/source.ts" },
        { kind: "working_diff" },
      ),
    ).toBe(false);
  });
});

describe("chat panel placement", () => {
  it("keeps supporting tabs in the main pane by default", () => {
    openPreferredWorkspaceTarget({
      isCompact: false,
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "/repo/README.md" },
      source: "chatFiles",
      preferences: DEFAULT_APP_SETTINGS.openInSidePane,
    });

    const state = useWorkspaceLayoutStore.getState();
    expect(state.sidePaneIdByWorkspace[WORKSPACE_KEY]).toBeUndefined();
    expect(
      collectAllTabs(state.layoutByWorkspace[WORKSPACE_KEY]!.root).map((tab) => tab.target.kind),
    ).toContain("file");
  });

  it("creates one right-side pane and reuses it for later supporting tabs", () => {
    const preferences = { ...DEFAULT_APP_SETTINGS.openInSidePane, chatFiles: true };
    openPreferredWorkspaceTarget({
      isCompact: false,
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "/repo/README.md" },
      source: "chatFiles",
      preferences,
    });
    const firstSidePaneId = useWorkspaceLayoutStore.getState().sidePaneIdByWorkspace[WORKSPACE_KEY];

    openPreferredWorkspaceTarget({
      isCompact: false,
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "working_diff" },
      source: "chatFiles",
      preferences,
    });

    const state = useWorkspaceLayoutStore.getState();
    expect(state.sidePaneIdByWorkspace[WORKSPACE_KEY]).toBe(firstSidePaneId);
    const sidePane = findPaneById(state.layoutByWorkspace[WORKSPACE_KEY]!.root, firstSidePaneId);
    const sideKinds = collectAllTabs(state.layoutByWorkspace[WORKSPACE_KEY]!.root)
      .filter((tab) => sidePane?.tabIds.includes(tab.tabId))
      .map((tab) => tab.target.kind);
    expect(sideKinds).toEqual(expect.arrayContaining(["file", "working_diff"]));
  });
});
