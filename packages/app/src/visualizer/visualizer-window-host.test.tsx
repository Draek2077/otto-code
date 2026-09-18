/** @vitest-environment jsdom */
import { useEffect, useState, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appVisible: true,
  settings: { visualizerPipOpen: true, visualizerBackgroundOpen: false },
  live: 0,
  peak: 0,
  events: [] as string[],
  pane: {
    serverId: "host",
    workspaceId: "a",
    tabId: "",
    target: { kind: "visualizer" as const },
    openFileInWorkspace: () => {},
  },
  paneVisible: true,
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/hooks/use-settings", () => ({ useAppSettings: () => ({ settings: state.settings }) }));
vi.mock("@/hooks/use-app-visible", () => ({ useAppVisible: () => state.appVisible }));
vi.mock("@/features/use-feature-enabled", () => ({ useFeatureEnabled: () => true }));
vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => false,
}));
// Leave inconsistent persisted settings intact to verify synchronous exclusion,
// before the reconciliation effect has had a chance to persist its correction.
vi.mock("@/visualizer/use-visualizer-surface", () => ({
  useReconcileVisualizerSurface: () => {},
  useVisualizerSurface: () => ({
    collapseToPip: () => {},
    expandToTab: () => {},
    closeBackground: () => {},
  }),
}));
vi.mock("@/hooks/use-animations-enabled", () => ({ useAnimationsEnabled: () => true }));
vi.mock("@/visualizer/use-chat-background-pointer", () => ({ useChatBackgroundPointer: () => {} }));
vi.mock("@/components/ui/toolbar-icon-button", () => ({ ToolbarIconButton: () => null }));
vi.mock("@/visualizer/visualizer-pip", () => ({ VisualizerPip: MockGuest }));
vi.mock("@/visualizer/visualizer-surface", () => ({ VisualizerSurface: MockGuest }));
vi.mock("@/panels/pane-context", () => ({
  usePaneContext: () => state.pane,
  usePaneFocus: () => ({ isVisible: state.paneVisible }),
}));

import { RetainedPanel } from "@/components/retained-panel";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { VisualizerPanel } from "@/panels/visualizer-panel";
import { VisualizerWindowProvider, useVisualizerWorkspaceSource } from "./visualizer-window-host";
import { getVisualizerTabs, VisualizerActiveWorkspaceContext } from "./visualizer-tab-owner";
import { ChatVisualizerBackground } from "./chat-visualizer-background";

function MockGuest({ workspaceId }: { workspaceId: string }) {
  const [mountedWorkspace] = useState(workspaceId);
  useEffect(() => {
    state.live++;
    state.peak = Math.max(state.peak, state.live);
    state.events.push(`mount:${mountedWorkspace}`);
    return () => {
      state.live--;
      state.events.push(`unmount:${mountedWorkspace}`);
    };
  }, [mountedWorkspace]);
  return <div data-testid="visualizer-guest">{workspaceId}</div>;
}
const openFile = () => {};
function Workspace({ id, active }: { id: string; active: boolean }) {
  useVisualizerWorkspaceSource({
    serverId: "host",
    workspaceId: id,
    isVisible: active,
    onOpenFile: openFile,
  });
  return null;
}
function Window({ active, children }: { active: string | null; children?: ReactNode }) {
  return (
    <VisualizerWindowProvider>
      <RetainedPanel active={active === "a"}>
        <Workspace id="a" active={active === "a"} />
      </RetainedPanel>
      <RetainedPanel active={active === "b"}>
        <Workspace id="b" active={active === "b"} />
      </RetainedPanel>
      {children}
    </VisualizerWindowProvider>
  );
}

beforeEach(() => {
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
  state.appVisible = true;
  state.settings = { visualizerPipOpen: true, visualizerBackgroundOpen: false };
  state.events = [];
  state.live = 0;
  state.peak = 0;
  state.paneVisible = true;
});
afterEach(cleanup);

function ActiveWorkspace({ children }: { children: ReactNode }) {
  return (
    <VisualizerActiveWorkspaceContext value="host:a">{children}</VisualizerActiveWorkspaceContext>
  );
}

describe("window visualizer ownership", () => {
  it("tears down the old workspace guest before initializing the next, with retained workspaces mounted", async () => {
    const view = render(<Window active="a" />);
    await screen.findByTestId("visualizer-guest");
    expect(screen.getAllByTestId("visualizer-guest")).toHaveLength(1);
    view.rerender(<Window active="b" />);
    expect(screen.getByTestId("visualizer-guest").textContent).toBe("b");
    expect(state.events).toEqual(["mount:a", "unmount:a", "mount:b"]);
    expect(state.peak).toBe(1);
    view.rerender(<Window active={null} />);
    expect(state.live).toBe(0);
    expect(screen.queryByTestId("visualizer-guest")).toBeNull();
  });

  it("unloads on close, minimization and background placement without an exit-fade hold", async () => {
    const view = render(<Window active="a" />);
    await screen.findByTestId("visualizer-guest");
    state.settings.visualizerPipOpen = false;
    view.rerender(<Window active="a" />);
    expect(state.live).toBe(0);
    state.settings.visualizerPipOpen = true;
    view.rerender(<Window active="a" />);
    expect(state.live).toBe(1);
    state.appVisible = false;
    view.rerender(<Window active="a" />);
    expect(state.live).toBe(0);
    state.appVisible = true;
    state.settings.visualizerBackgroundOpen = true;
    view.rerender(<Window active="a" />);
    expect(state.live).toBe(0);
    expect(state.peak).toBe(1);
  });

  it("only lets a tab in the active workspace replace its PIP", async () => {
    const view = render(<Window active="a" />);
    await screen.findByTestId("visualizer-guest");
    act(() => {
      useWorkspaceLayoutStore.getState().openTabFocused("host:b", { kind: "visualizer" });
    });
    expect(state.live).toBe(1);
    expect(screen.getByTestId("visualizer-guest").textContent).toBe("a");
    view.rerender(<Window active="b" />);
    expect(state.live).toBe(0);
    view.rerender(<Window active="a" />);
    expect(state.live).toBe(1);
    expect(
      getVisualizerTabs(useWorkspaceLayoutStore.getState().layoutByWorkspace).map(
        ({ workspaceKey }) => workspaceKey,
      ),
    ).toEqual(["host:b"]);
    expect(state.peak).toBe(1);
  });

  it("reconciles duplicates within the active workspace and preserves inactive workspace tabs", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.openTabFocused("host:a", { kind: "visualizer", runId: "old" });
    store.openTabFocused("host:b", { kind: "visualizer", runId: "current" });
    store.openTabFocused("host:b", { kind: "visualizer", runId: "duplicate" });
    render(<Window active="b" />);
    expect(
      getVisualizerTabs(useWorkspaceLayoutStore.getState().layoutByWorkspace).map(
        ({ workspaceKey }) => workspaceKey,
      ),
    ).toEqual(["host:a", "host:b"]);
    expect(state.live).toBe(0);
  });

  it("preserves both workspace tabs and reinitializes A after switching A to B to A", () => {
    const store = useWorkspaceLayoutStore.getState();
    const tabA = store.openTabFocused("host:a", { kind: "visualizer" })!;
    const tabB = store.openTabFocused("host:b", { kind: "visualizer" })!;
    state.pane.workspaceId = "a";
    state.pane.tabId = tabA;
    const view = render(
      <Window active="a">
        <VisualizerPanel />
      </Window>,
    );
    expect(state.live).toBe(1);
    state.pane.workspaceId = "b";
    state.pane.tabId = tabB;
    view.rerender(
      <Window active="b">
        <VisualizerPanel />
      </Window>,
    );
    expect(screen.getByTestId("visualizer-guest").textContent).toBe("b");
    state.pane.workspaceId = "a";
    state.pane.tabId = tabA;
    view.rerender(
      <Window active="a">
        <VisualizerPanel />
      </Window>,
    );
    expect(screen.getByTestId("visualizer-guest").textContent).toBe("a");
    expect(state.events).toEqual(["mount:a", "unmount:a", "mount:b", "unmount:b", "mount:a"]);
    expect(state.live).toBe(1);
    expect(state.peak).toBe(1);
    expect(
      getVisualizerTabs(useWorkspaceLayoutStore.getState().layoutByWorkspace).map(
        ({ workspaceKey, tab }) => [workspaceKey, tab.tabId],
      ),
    ).toEqual([
      ["host:a", tabA],
      ["host:b", tabB],
    ]);
  });

  it("never overlaps tab and PIP guests during placement changes with animations enabled", async () => {
    function Placements() {
      return (
        <VisualizerWindowProvider>
          <Workspace id="a" active />
          <VisualizerPanel />
        </VisualizerWindowProvider>
      );
    }
    const view = render(<Placements />);
    await screen.findByTestId("visualizer-guest");
    act(() => {
      state.pane.tabId = useWorkspaceLayoutStore
        .getState()
        .openTabFocused("host:a", { kind: "visualizer" })!;
    });
    view.rerender(<Placements />);
    expect(state.live).toBe(1);
    expect(state.events).toEqual(["mount:a", "unmount:a", "mount:a"]);
    act(() => {
      useWorkspaceLayoutStore.getState().closeTab("host:a", state.pane.tabId);
    });
    expect(state.live).toBe(1);
    expect(state.peak).toBe(1);
  });
});

describe("tab guest lifecycle", () => {
  it("unloads hidden tabs and recreates only the currently visible guest", () => {
    state.pane.tabId = useWorkspaceLayoutStore
      .getState()
      .openTabFocused("host:a", { kind: "visualizer" })!;
    const view = render(
      <RetainedPanel active>
        <VisualizerPanel />
      </RetainedPanel>,
      { wrapper: ActiveWorkspace },
    );
    expect(state.live).toBe(1);
    state.paneVisible = false;
    view.rerender(
      <RetainedPanel active>
        <VisualizerPanel />
      </RetainedPanel>,
    );
    expect(state.live).toBe(0);
    state.paneVisible = true;
    view.rerender(
      <RetainedPanel active>
        <VisualizerPanel />
      </RetainedPanel>,
    );
    expect(state.live).toBe(1);
    view.rerender(
      <RetainedPanel active={false}>
        <VisualizerPanel />
      </RetainedPanel>,
    );
    expect(state.live).toBe(0);
    expect(state.peak).toBe(1);
  });

  it("does not initialize a second tab guest before restored duplicates are reconciled", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.openTabFocused("host:a", { kind: "visualizer", runId: "first" });
    state.pane.tabId = store.openTabFocused("host:a", { kind: "visualizer", runId: "second" })!;
    render(<VisualizerPanel />, { wrapper: ActiveWorkspace });
    expect(state.live).toBe(0);
  });
});

it("unloads a chat background when its workspace is retained but hidden", async () => {
  state.settings = { visualizerPipOpen: false, visualizerBackgroundOpen: true };
  state.pane.tabId = useWorkspaceLayoutStore
    .getState()
    .openTabFocused("host:a", { kind: "draft", draftId: "chat" })!;
  function Background({ active }: { active: boolean }) {
    return (
      <RetainedPanel active={active}>
        <ChatVisualizerBackground>
          <div>Conversation</div>
          <div>Composer</div>
        </ChatVisualizerBackground>
      </RetainedPanel>
    );
  }
  const view = render(<Background active />);
  await screen.findByTestId("visualizer-guest");
  expect(state.live).toBe(1);
  view.rerender(<Background active={false} />);
  expect(state.live).toBe(0);
  expect(screen.getByText("Conversation").textContent).toBe("Conversation");
  view.rerender(<Background active />);
  expect(state.live).toBe(1);
  state.appVisible = false;
  view.rerender(<Background active />);
  expect(state.live).toBe(0);
});
