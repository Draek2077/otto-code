/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React, { type ReactElement } from "react";
import { act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkspaceScriptPayload } from "@otto-code/protocol/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { WorkspaceScriptsButton } from "@/screens/workspace/workspace-scripts-button";
import { useScriptMenuPreferencesStore } from "@/screens/workspace/script-menu-preferences-store";

void testI18n;

const {
  theme,
  startWorkspaceScriptMock,
  killTerminalMock,
  setStringAsyncMock,
  copiedToastMock,
  routePreferenceByServerIdMock,
  routePreferenceListenersMock,
  setPreferredRouteMock,
  discoveryEnabledRef,
  listWorkspaceScriptsMock,
} = vi.hoisted(() => {
  const hoistedTheme = {
    spacing: { 1: 4, 1.5: 6, 2: 8, 3: 12 },
    borderWidth: { 1: 1 },
    borderRadius: { md: 6, lg: 8 },
    fontSize: { xs: 11, sm: 13, code: 12 },
    fontWeight: { normal: "400", medium: "500" },
    fontFamily: { ui: "Inter", mono: "JetBrains Mono" },
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface2: "#222",
      borderAccent: "#444",
      palette: {
        blue: { 500: "#0a84ff" },
        green: { 500: "#30d158" },
        red: { 300: "#ff9f99", 500: "#ff453a" },
      },
    },
  };

  const routePreferenceByServerId: Record<string, "public" | "otto" | "direct"> = {};
  const routePreferenceListeners = new Set<() => void>();
  const setPreferredRoute = vi.fn((serverId: string, kind: "public" | "otto" | "direct") => {
    routePreferenceByServerId[serverId] = kind;
    for (const listener of routePreferenceListeners) listener();
  });

  // COMPAT(workspaceScriptDiscovery): the daemon capability the grouped list is
  // gated on. Mutable so one file can cover both the gated-off shape (the
  // pre-discovery menu) and the grouped one.
  const discoveryEnabled = { value: false };

  return {
    discoveryEnabledRef: discoveryEnabled,
    listWorkspaceScriptsMock: vi.fn(
      async (): Promise<{
        requestId: string;
        workspaceId: string;
        scripts: WorkspaceScriptPayload[];
        error: string | null;
      }> => ({
        requestId: "req-list",
        workspaceId: "workspace-1",
        scripts: [],
        error: null,
      }),
    ),
    theme: hoistedTheme,
    startWorkspaceScriptMock: vi.fn(async () => ({ terminalId: "terminal-script-1" })),
    killTerminalMock: vi.fn(async () => ({
      terminalId: "terminal-script-1",
      success: true,
      requestId: "request-1",
    })),
    setStringAsyncMock: vi.fn(async () => true),
    copiedToastMock: vi.fn(),
    routePreferenceByServerIdMock: routePreferenceByServerId,
    routePreferenceListenersMock: routePreferenceListeners,
    setPreferredRouteMock: setPreferredRoute,
  };
});

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  // The sheet this button opens is one of the tolerated `useUnistyles()` call
  // sites (docs/unistyles.md bans it for new code, not the ones already there),
  // so the mock has to answer it or every test in the file dies on the import.
  // `rt` comes with it because useIsCompactFormFactor reads rt.breakpoint, and a
  // desktop breakpoint is what the isWeb platform mock below implies.
  useUnistyles: () => ({ theme, rt: { breakpoint: "lg" } }),
  withUnistyles:
    (Component: React.ComponentType<Record<string, unknown>>) =>
    ({
      uniProps,
      ...rest
    }: {
      uniProps?: (theme: unknown) => Record<string, unknown>;
    } & Record<string, unknown>) => {
      const themed = uniProps ? uniProps(theme) : {};
      return React.createElement(Component, { ...rest, ...themed });
    },
}));

vi.mock("@/constants/platform", () => ({
  isNative: false,
  isWeb: true,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeSnapshot: () => ({ activeConnection: null }),
}));

vi.mock("@/workspace-service-routes/store", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  const state = {
    byServerId: routePreferenceByServerIdMock,
    setPreferredRoute: setPreferredRouteMock,
  };
  return {
    useWorkspaceServiceRoutePreferencesStore: <T,>(selector: (value: typeof state) => T) =>
      ReactModule.useSyncExternalStore(
        (listener) => {
          routePreferenceListenersMock.add(listener);
          return () => routePreferenceListenersMock.delete(listener);
        },
        () => selector(state),
        () => selector(state),
      ),
  };
});

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "test-server": {
          serverInfo: {
            features: { workspaceScriptDiscovery: discoveryEnabledRef.value },
          },
          client: {
            startWorkspaceScript: startWorkspaceScriptMock,
            killTerminal: killTerminalMock,
            listWorkspaceScripts: listWorkspaceScriptsMock,
          },
        },
      },
    }),
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ show: vi.fn(), error: vi.fn(), copied: copiedToastMock }),
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: setStringAsyncMock,
}));

vi.mock("@/utils/open-external-url", () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  DropdownMenuSeparator: () => <div role="separator" />,
  DropdownMenuLabel: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    description,
    onSelect,
    testID,
  }: {
    children: React.ReactNode;
    description?: string;
    onSelect?: () => void;
    testID?: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onSelect}>
      {children}
      {description}
    </button>
  ),
  DropdownMenuTrigger: ({
    children,
    testID,
  }: {
    children:
      | React.ReactNode
      | ((state: { hovered: boolean; pressed: boolean; open: boolean }) => React.ReactNode);
    testID?: string;
  }) => (
    <button type="button" data-testid={testID}>
      {typeof children === "function"
        ? children({ hovered: false, pressed: false, open: true })
        : children}
    </button>
  ),
  useDropdownMenuClose: () => () => {},
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children as ReactElement,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children as ReactElement,
  TooltipContent: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
}));

// Mocks the module the component actually imports. It moved off
// lucide-react-native onto the material symbol map, and the stale lucide mock
// left the real SVG icons rendering — which carry no `data-icon`, so every row
// lookup in here came back empty. Derived from the real export list rather than
// a hand-written set, so an icon added to the component cannot silently blank
// these assertions again.
vi.mock("@/components/icons/material-icons", async () => {
  const actualMaterialIcons = await vi.importActual<Record<string, unknown>>(
    "@/components/icons/material-icons",
  );
  const createIcon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("span", {
      "data-icon": name,
      "data-color": props.color,
      "data-size": props.size,
      "data-testid": props.testID,
    });
  return Object.fromEntries(
    Object.keys(actualMaterialIcons).map((name) => [name, createIcon(name)]),
  );
});

vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return actual;
});

function script(
  input: Partial<WorkspaceScriptPayload> & Pick<WorkspaceScriptPayload, "scriptName">,
): WorkspaceScriptPayload {
  return {
    scriptName: input.scriptName,
    type: input.type ?? "script",
    hostname: input.hostname ?? input.scriptName,
    port: input.port ?? null,
    localProxyUrl: input.localProxyUrl,
    publicProxyUrl: input.publicProxyUrl,
    proxyUrl: input.proxyUrl ?? null,
    lifecycle: input.lifecycle ?? "stopped",
    health: input.health ?? null,
    exitCode: input.exitCode ?? null,
    terminalId: input.terminalId ?? null,
  };
}

const LIVE_TERMINAL_IDS: string[] = ["terminal-script-1"];

interface RenderScriptsOptions {
  hideLabels?: boolean;
  presentation?: "split" | "ghost";
}

function renderScripts(
  scripts: WorkspaceScriptPayload[],
  options: RenderScriptsOptions = {},
): {
  rerender: (nextScripts: WorkspaceScriptPayload[]) => Promise<void>;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function element(nextScripts: WorkspaceScriptPayload[]): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <WorkspaceScriptsButton
          serverId="test-server"
          workspaceId="workspace-1"
          scripts={nextScripts}
          liveTerminalIds={LIVE_TERMINAL_IDS}
          onScriptTerminalStarted={vi.fn()}
          onViewTerminal={vi.fn()}
          hideLabels={options.hideLabels}
          presentation={options.presentation}
        />
      </QueryClientProvider>
    );
  }

  act(() => {
    root.render(element(scripts));
  });

  return {
    rerender: async (nextScripts) => {
      await act(async () => {
        root.render(element(nextScripts));
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function requireRow(scriptName: string): HTMLElement {
  const row = document.querySelector(`[data-testid="workspace-scripts-item-${scriptName}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`Missing script row for ${scriptName}`);
  }
  return row;
}

function requirePrimaryIcon(row: HTMLElement): HTMLElement {
  const icon = row.querySelector("[data-icon]");
  if (!(icon instanceof HTMLElement)) {
    throw new Error("Missing row icon");
  }
  return icon;
}

describe("WorkspaceScriptsButton", () => {
  let current: ReturnType<typeof renderScripts> | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    document.body.innerHTML = "";
    startWorkspaceScriptMock.mockClear();
    killTerminalMock.mockClear();
    setStringAsyncMock.mockClear();
    copiedToastMock.mockClear();
    setPreferredRouteMock.mockClear();
    listWorkspaceScriptsMock.mockClear();
    discoveryEnabledRef.value = false;
    for (const serverId of Object.keys(routePreferenceByServerIdMock)) {
      delete routePreferenceByServerIdMock[serverId];
    }
  });

  afterEach(() => {
    current?.unmount();
    current = null;
    vi.unstubAllGlobals();
  });

  it("keeps completed script row icons visible and muted while the menu content stays mounted", async () => {
    current = renderScripts([
      script({
        scriptName: "typecheck",
        lifecycle: "running",
        terminalId: "terminal-script-1",
      }),
    ]);

    let row = requireRow("typecheck");
    let icon = requirePrimaryIcon(row);
    expect(icon.dataset.icon).toBe("SquareTerminal");
    expect(icon.dataset.color).toBe(theme.colors.palette.blue[500]);

    await current.rerender([
      script({
        scriptName: "typecheck",
        lifecycle: "stopped",
        exitCode: 0,
        terminalId: "terminal-script-1",
      }),
    ]);

    row = requireRow("typecheck");
    icon = requirePrimaryIcon(row);
    expect(icon.dataset.icon).toBe("SquareTerminal");
    expect(icon.dataset.color).toBe(theme.colors.foregroundMuted);
    expect(row.textContent).toContain("typecheck");
    expect(row.textContent).toContain("exit 0");
    expect(row.querySelector('[data-testid="workspace-scripts-start-typecheck"]')).not.toBeNull();

    await current.rerender([
      script({
        scriptName: "typecheck",
        lifecycle: "stopped",
        exitCode: 7,
        terminalId: "terminal-script-1",
      }),
    ]);

    row = requireRow("typecheck");
    icon = requirePrimaryIcon(row);
    expect(icon.dataset.icon).toBe("SquareTerminal");
    expect(icon.dataset.color).toBe(theme.colors.foregroundMuted);
    expect(row.textContent).toContain("exit 7");
    expect(row.querySelector('[data-testid="workspace-scripts-start-typecheck"]')).not.toBeNull();
  });

  it("uses service icon color for service health and running unknown status only", () => {
    current = renderScripts([
      script({
        scriptName: "web",
        type: "service",
        hostname: "web.otto.localhost",
        lifecycle: "running",
        health: "healthy",
        port: 3000,
      }),
      script({
        scriptName: "api",
        type: "service",
        hostname: "api.otto.localhost",
        lifecycle: "running",
        health: "unhealthy",
        port: 4000,
      }),
      script({
        scriptName: "worker",
        type: "service",
        hostname: "worker.otto.localhost",
        lifecycle: "running",
        health: null,
        port: 5000,
      }),
      script({
        scriptName: "old-service",
        type: "service",
        hostname: "old-service.otto.localhost",
        lifecycle: "stopped",
        exitCode: 1,
      }),
    ]);

    expect(requirePrimaryIcon(requireRow("web")).dataset.color).toBe(
      theme.colors.palette.green[500],
    );
    expect(requirePrimaryIcon(requireRow("api")).dataset.color).toBe(theme.colors.palette.red[500]);
    expect(requirePrimaryIcon(requireRow("worker")).dataset.color).toBe(
      theme.colors.palette.blue[500],
    );
    expect(requirePrimaryIcon(requireRow("old-service")).dataset.color).toBe(
      theme.colors.foregroundMuted,
    );
  });

  it("removes the trigger caret in ghost presentation", () => {
    current = renderScripts([script({ scriptName: "dev" })], {
      hideLabels: true,
      presentation: "ghost",
    });

    const trigger = document.querySelector('[data-testid="workspace-scripts-button"]');
    expect(trigger?.querySelector('[data-icon="Play"]')?.getAttribute("data-size")).toBe("16");
    expect(trigger?.querySelector('[data-icon="ChevronDown"]')).toBeNull();
  });

  it("keeps the trigger caret in split presentation", () => {
    current = renderScripts([script({ scriptName: "dev" })]);

    const trigger = document.querySelector('[data-testid="workspace-scripts-button"]');
    expect(trigger?.querySelector('[data-icon="ChevronDown"]')).not.toBeNull();
  });

  it("persists the selected route for the host", () => {
    const scripts = [
      script({
        scriptName: "dev",
        type: "service",
        hostname: "dev--proj--repo.localhost",
        lifecycle: "running",
        port: 57483,
        proxyUrl: "http://dev--proj--repo.localhost:6868",
        terminalId: "terminal-script-1",
      }),
    ];
    current = renderScripts(scripts);

    const row = requireRow("dev");
    expect(row.textContent).toContain("dev--proj--repo.localhost:6868");

    const routeButton = row.querySelector('[data-testid="workspace-scripts-route-dev"]');
    expect(routeButton).not.toBeNull();
    fireEvent.click(
      row.querySelector('[data-testid="workspace-scripts-route-dev-direct"]') as HTMLElement,
    );
    expect(setPreferredRouteMock).toHaveBeenCalledWith("test-server", "direct");
    expect(row.textContent).toContain("localhost:57483");

    const copyButton = row.querySelector('[data-testid="workspace-scripts-copy-dev"]');
    expect(copyButton).not.toBeNull();
    fireEvent.click(copyButton as HTMLElement);
    expect(setStringAsyncMock).toHaveBeenCalledWith("http://localhost:57483");
    expect(copiedToastMock).toHaveBeenCalledWith("localhost:57483");

    current.unmount();
    current = renderScripts(scripts);
    expect(requireRow("dev").textContent).toContain("localhost:57483");
  });

  it("defaults to a configured reverse proxy URL", () => {
    current = renderScripts([
      script({
        scriptName: "dev",
        type: "service",
        lifecycle: "running",
        port: 57483,
        localProxyUrl: "http://dev--proj--repo.localhost:6868",
        publicProxyUrl: "https://dev--proj--repo.services.example.com",
        proxyUrl: "https://dev--proj--repo.services.example.com",
        terminalId: "terminal-script-1",
      }),
    ]);

    expect(requireRow("dev").textContent).toContain("dev--proj--repo.services.example.com");
  });

  it("stops a running script through its terminal", async () => {
    current = renderScripts([
      script({
        scriptName: "dev",
        lifecycle: "running",
        terminalId: "terminal-script-1",
      }),
    ]);

    const stopButton = requireRow("dev").querySelector(
      '[data-testid="workspace-scripts-stop-dev"]',
    );
    expect(stopButton).not.toBeNull();
    fireEvent.click(stopButton as HTMLElement);
    await act(async () => {});

    expect(killTerminalMock).toHaveBeenCalledWith("terminal-script-1");
  });

  it("uses icon-only actions with view and fixed-position lifecycle controls", async () => {
    current = renderScripts([
      script({
        scriptName: "dev",
        lifecycle: "stopped",
        terminalId: "terminal-script-1",
      }),
    ]);

    let row = requireRow("dev");
    let buttons = Array.from(row.querySelectorAll("button"));
    expect(buttons).toHaveLength(1);
    expect(buttons.at(-1)?.dataset.testid).toBe("workspace-scripts-start-dev");
    expect(buttons.at(-1)?.querySelector('[data-icon="Play"]')).not.toBeNull();
    expect(buttons.at(-1)?.textContent).toBe("");

    await current.rerender([
      script({
        scriptName: "dev",
        lifecycle: "running",
        terminalId: "terminal-script-1",
      }),
    ]);

    row = requireRow("dev");
    buttons = Array.from(row.querySelectorAll("button"));
    expect(buttons.map((button) => button.dataset.testid)).toEqual([
      "workspace-scripts-view-dev",
      "workspace-scripts-restart-dev",
      "workspace-scripts-stop-dev",
    ]);
    expect(buttons[0]?.querySelector('[data-icon="SquareTerminal"]')).not.toBeNull();
    expect(buttons.at(-1)?.querySelector('[data-icon="Square"]')).not.toBeNull();
    expect(buttons.every((button) => button.textContent === "")).toBe(true);
  });

  it("adds localized tooltips to every icon action", () => {
    current = renderScripts([
      script({
        scriptName: "dev",
        type: "service",
        lifecycle: "running",
        port: 3000,
        proxyUrl: "http://dev--project.localhost:6868",
        terminalId: "terminal-script-1",
      }),
    ]);

    expect(
      document.querySelector('[data-testid="workspace-scripts-view-dev-tooltip"]')?.textContent,
    ).toBe("View terminal");
    expect(
      document.querySelector('[data-testid="workspace-scripts-restart-dev-tooltip"]')?.textContent,
    ).toBe("Restart");
    expect(
      document.querySelector('[data-testid="workspace-scripts-stop-dev-tooltip"]')?.textContent,
    ).toBe("Stop");
    expect(
      document.querySelector('[data-testid="workspace-scripts-copy-dev-tooltip"]')?.textContent,
    ).toBe("Copy URL");
    expect(
      document.querySelector('[data-testid="workspace-scripts-route-dev-tooltip"]')?.textContent,
    ).toBe("Choose URL");
  });

  it("restarts a script once its stopped lifecycle arrives", async () => {
    current = renderScripts([
      script({
        scriptName: "dev",
        lifecycle: "running",
        terminalId: "terminal-script-1",
      }),
    ]);

    const restartButton = requireRow("dev").querySelector(
      '[data-testid="workspace-scripts-restart-dev"]',
    );
    expect(restartButton).not.toBeNull();
    fireEvent.click(restartButton as HTMLElement);
    await act(async () => {});

    expect(killTerminalMock).toHaveBeenCalledWith("terminal-script-1");
    expect(startWorkspaceScriptMock).not.toHaveBeenCalled();

    await current.rerender([
      script({
        scriptName: "dev",
        lifecycle: "stopped",
        exitCode: 0,
        terminalId: "terminal-script-1",
      }),
    ]);
    await act(async () => {});

    expect(startWorkspaceScriptMock).toHaveBeenCalledWith("workspace-1", "dev");
  });
});

// react-query resolves the fetch across several microtask turns before the
// component re-renders with data; one act() flush is not enough.
/** Idempotent: the header is a toggle, so clicking an open group would close it. */
async function expandGroup(groupKey: string): Promise<void> {
  const header = document.querySelector(`[data-testid="workspace-scripts-group-${groupKey}"]`);
  if (!(header instanceof HTMLElement)) {
    throw new Error(`Missing group header for ${groupKey}`);
  }
  if (header.getAttribute("aria-expanded") === "true") {
    return;
  }
  fireEvent.click(header);
  await flushQueries();
}

async function flushQueries(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("WorkspaceScriptsButton discovery", () => {
  let current: ReturnType<typeof renderScripts> | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    document.body.innerHTML = "";
    startWorkspaceScriptMock.mockClear();
    listWorkspaceScriptsMock.mockClear();
    discoveryEnabledRef.value = true;
    // The preferences store is a real module singleton, so collapse state and
    // run history leak between tests unless it is reset.
    useScriptMenuPreferencesStore.setState({
      lastRunAtByWorkspace: {},
      groupExpansionByWorkspace: {},
    });
  });

  afterEach(() => {
    current?.unmount();
    current = null;
    discoveryEnabledRef.value = false;
    vi.unstubAllGlobals();
  });

  function discovered(input: {
    scriptName: string;
    label: string;
    command: string;
    file?: string;
    sourceLabel?: string;
  }): WorkspaceScriptPayload {
    return {
      ...script({ scriptName: input.scriptName }),
      label: input.label,
      command: input.command,
      source: {
        id: "npm",
        label: input.sourceLabel ?? "npm",
        file: input.file ?? "package.json",
      },
    };
  }

  it("groups discovered scripts under a header naming their source", async () => {
    listWorkspaceScriptsMock.mockResolvedValueOnce({
      requestId: "req-list",
      workspaceId: "workspace-1",
      scripts: [
        { ...script({ scriptName: "app" }), command: "node app.js" },
        discovered({ scriptName: "npm:build", label: "build", command: "npm run build" }),
      ],
      error: null,
    });

    current = renderScripts([script({ scriptName: "app" })]);
    await flushQueries();

    expect(
      document.querySelector('[data-testid="workspace-scripts-group-otto"]')?.textContent,
    ).toBe("Otto");
    // The discovered header names its source and its row count, and starts
    // collapsed: its rows are not in the DOM until the user opens it.
    expect(
      document.querySelector('[data-testid="workspace-scripts-group-npm:package.json"]')
        ?.textContent,
    ).toBe("npm · package.json1");
    expect(document.querySelector('[data-testid="workspace-scripts-item-npm:build"]')).toBeNull();

    await expandGroup("npm:package.json");

    // The row shows the project's own name, not the qualified wire key.
    expect(requireRow("npm:build").textContent).toContain("build");
    expect(requireRow("npm:build").textContent).toContain("npm run build");
  });

  it("shows the Play button for a project whose only scripts are discovered", async () => {
    listWorkspaceScriptsMock.mockResolvedValueOnce({
      requestId: "req-list",
      workspaceId: "workspace-1",
      scripts: [discovered({ scriptName: "npm:dev", label: "dev", command: "npm run dev" })],
      error: null,
    });

    current = renderScripts([]);
    await flushQueries();

    expect(document.querySelector('[data-testid="workspace-scripts-button"]')).not.toBeNull();
    await expandGroup("npm:package.json");
    expect(requireRow("npm:dev")).not.toBeNull();
  });

  it("starts a discovered script by its qualified name", async () => {
    listWorkspaceScriptsMock.mockResolvedValueOnce({
      requestId: "req-list",
      workspaceId: "workspace-1",
      scripts: [discovered({ scriptName: "npm:dev", label: "dev", command: "npm run dev" })],
      error: null,
    });

    current = renderScripts([]);
    await flushQueries();
    await expandGroup("npm:package.json");

    const start = document.querySelector('[data-testid="workspace-scripts-start-npm:dev"]');
    fireEvent.click(start as HTMLElement);
    await flushQueries();

    expect(startWorkspaceScriptMock).toHaveBeenCalledWith("workspace-1", "npm:dev");
  });

  it("overlays live status from the descriptor onto the fetched list", async () => {
    listWorkspaceScriptsMock.mockResolvedValueOnce({
      requestId: "req-list",
      workspaceId: "workspace-1",
      scripts: [discovered({ scriptName: "npm:dev", label: "dev", command: "npm run dev" })],
      error: null,
    });

    current = renderScripts([]);
    await flushQueries();
    await expandGroup("npm:package.json");
    expect(
      document.querySelector('[data-testid="workspace-scripts-start-npm:dev"]'),
    ).not.toBeNull();

    // The daemon pushes the running orphan through the descriptor; the fetched
    // list is not refetched, so the Stop control has to come from the overlay.
    await current.rerender([
      {
        ...script({ scriptName: "npm:dev", lifecycle: "running", terminalId: "terminal-script-1" }),
      },
    ]);
    await flushQueries();

    expect(document.querySelector('[data-testid="workspace-scripts-stop-npm:dev"]')).not.toBeNull();
    expect(requireRow("npm:dev").textContent).toContain("npm run dev");
  });

  it("renders no group headers when everything came from otto.json", async () => {
    listWorkspaceScriptsMock.mockResolvedValueOnce({
      requestId: "req-list",
      workspaceId: "workspace-1",
      scripts: [{ ...script({ scriptName: "app" }), command: "node app.js" }],
      error: null,
    });

    current = renderScripts([script({ scriptName: "app" })]);
    await flushQueries();

    expect(document.querySelector('[data-testid="workspace-scripts-group-otto"]')).toBeNull();
  });
});

describe("WorkspaceScriptsButton menu ergonomics", () => {
  let current: ReturnType<typeof renderScripts> | null = null;

  function manyDiscovered(count: number): WorkspaceScriptPayload[] {
    return Array.from({ length: count }, (_, index) => ({
      ...script({ scriptName: `npm:task-${index}` }),
      label: `task-${index}`,
      command: `npm run task-${index}`,
      source: { id: "npm", label: "npm", file: "package.json" },
    }));
  }

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    document.body.innerHTML = "";
    startWorkspaceScriptMock.mockClear();
    listWorkspaceScriptsMock.mockClear();
    discoveryEnabledRef.value = true;
    useScriptMenuPreferencesStore.setState({
      lastRunAtByWorkspace: {},
      groupExpansionByWorkspace: {},
    });
  });

  afterEach(() => {
    current?.unmount();
    current = null;
    discoveryEnabledRef.value = false;
    vi.unstubAllGlobals();
  });

  it("shows two rows on first open of a 100-script project", async () => {
    listWorkspaceScriptsMock.mockResolvedValueOnce({
      requestId: "req-list",
      workspaceId: "workspace-1",
      scripts: [
        { ...script({ scriptName: "daemon" }), command: "./scripts/dev-daemon.sh" },
        { ...script({ scriptName: "app" }), command: "./scripts/dev-app.sh" },
        ...manyDiscovered(98),
      ],
      error: null,
    });

    current = renderScripts([]);
    await flushQueries();

    const rows = document.querySelectorAll('[data-testid^="workspace-scripts-item-"]');
    expect(rows).toHaveLength(2);
    expect(
      document.querySelector('[data-testid="workspace-scripts-group-npm:package.json"]')
        ?.textContent,
    ).toBe("npm · package.json98");
  });

  it("filters across the collapsed tree without the user expanding anything", async () => {
    listWorkspaceScriptsMock.mockResolvedValueOnce({
      requestId: "req-list",
      workspaceId: "workspace-1",
      scripts: [{ ...script({ scriptName: "daemon" }) }, ...manyDiscovered(98)],
      error: null,
    });

    current = renderScripts([]);
    await flushQueries();

    const filter = document.querySelector('[data-testid="workspace-scripts-filter"]');
    expect(filter).not.toBeNull();
    fireEvent.change(filter as HTMLElement, { target: { value: "task-42" } });
    await flushQueries();

    const rows = document.querySelectorAll('[data-testid^="workspace-scripts-item-"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute("data-testid")).toBe("workspace-scripts-item-npm:task-42");
  });

  it("hides the filter for a menu short enough to scan", async () => {
    listWorkspaceScriptsMock.mockResolvedValueOnce({
      requestId: "req-list",
      workspaceId: "workspace-1",
      scripts: [{ ...script({ scriptName: "daemon" }) }, ...manyDiscovered(3)],
      error: null,
    });

    current = renderScripts([]);
    await flushQueries();

    expect(document.querySelector('[data-testid="workspace-scripts-filter"]')).toBeNull();
  });

  it("lifts a script into Recent once it has been run", async () => {
    listWorkspaceScriptsMock.mockResolvedValue({
      requestId: "req-list",
      workspaceId: "workspace-1",
      scripts: [{ ...script({ scriptName: "daemon" }) }, ...manyDiscovered(98)],
      error: null,
    });

    current = renderScripts([]);
    await flushQueries();
    expect(document.querySelector('[data-testid="workspace-scripts-group-recent"]')).toBeNull();

    await expandGroup("npm:package.json");
    fireEvent.click(
      document.querySelector('[data-testid="workspace-scripts-start-npm:task-7"]') as HTMLElement,
    );
    await flushQueries();

    expect(document.querySelector('[data-testid="workspace-scripts-group-recent"]')).not.toBeNull();
    expect(startWorkspaceScriptMock).toHaveBeenCalledWith("workspace-1", "npm:task-7");
  });
});
