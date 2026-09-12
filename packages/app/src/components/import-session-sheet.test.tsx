/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  DaemonClient,
  FetchRecentProviderSessionEntry,
} from "@otto-code/client/internal/daemon-client";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportSessionSheet } from "@/components/import-session-sheet";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 6: 24 },
    borderWidth: { 1: 1 },
    borderRadius: { md: 6, lg: 8, full: 9999 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { normal: "400", medium: "500", semibold: "600" },
    iconSize: { sm: 14, md: 16 },
    opacity: { 50: 0.5 },
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface0: "#000",
      surface1: "#111",
      surface2: "#222",
      surface3: "#333",
      border: "#444",
      borderAccent: "#555",
    },
  },
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
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

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
    testID,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
    testID?: string;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled} data-testid={testID}>
      {children}
    </button>
  ),
}));

vi.mock("@/runtime/host-features", () => ({ useHostFeature: () => true }));

vi.mock("@/components/provider-icons", () => ({
  getProviderIcon: () => () => null,
}));

vi.mock("@/components/icons/material-icons", () => {
  const icon = (name: string) => {
    const Icon = () => React.createElement("span", { "data-icon": name });
    Icon.displayName = name;
    return Icon;
  };
  return {
    Check: icon("Check"),
    ChevronDown: icon("ChevronDown"),
    Inbox: icon("Inbox"),
    Layers: icon("Layers"),
    RotateCw: icon("RotateCw"),
  };
});

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () =>
    React.createElement("span", { "data-testid": "import-session-loading-spinner" }),
}));

vi.mock("@/components/ui/combobox", () => ({
  Combobox: ({
    options,
    value,
    onSelect,
    open,
  }: {
    options: ReadonlyArray<{ id: string; label: string }>;
    value: string;
    onSelect: (id: string) => void;
    open?: boolean;
  }) => {
    if (!open) return null;
    return React.createElement(
      "div",
      { "data-testid": "import-session-combobox" },
      options.map((option) =>
        React.createElement(
          "button",
          {
            key: option.id,
            type: "button",
            "data-testid": `import-session-filter-${option.id === "__all__" ? "all" : option.id}`,
            "data-selected": value === option.id,
            onClick: () => onSelect(option.id),
          },
          option.label,
        ),
      ),
    );
  },
  ComboboxItem: ({ label }: { label: string }) => React.createElement("span", null, label),
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    visible,
    header,
    children,
    footer,
    testID,
  }: {
    visible: boolean;
    header?: { title: string; actions?: ReactNode };
    children: ReactNode;
    // Action buttons are pinned below the scroll region, not part of the body,
    // so the mock has to render the slot or every button assertion sees null.
    footer?: ReactNode;
    testID?: string;
  }) =>
    visible ? (
      <section data-testid={testID}>
        <h1>{header?.title}</h1>
        {header?.actions}
        {children}
        {footer}
      </section>
    ) : null,
}));

vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return actual;
});

const mockSnapshot = vi.hoisted(() => ({
  current: {
    entries: undefined as ProviderSnapshotEntry[] | undefined,
    supportsSnapshot: false,
  },
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    entries: mockSnapshot.current.entries,
    isLoading: false,
    isFetching: false,
    isRefreshing: false,
    error: null,
    supportsSnapshot: mockSnapshot.current.supportsSnapshot,
    refresh: vi.fn(),
    refetchIfStale: vi.fn(),
  }),
}));

interface RenderOptions {
  visible?: boolean;
  onClose?: () => void;
  onImportedAgent?: (agentId: string) => void;
  onImported?: (agent: Awaited<ReturnType<DaemonClient["importAgent"]>>) => void;
  cwd?: string | null;
  workspaceId?: string | null;
  snapshot?: {
    entries?: ProviderSnapshotEntry[];
    supportsSnapshot?: boolean;
  };
}

function renderSheet(
  client: Pick<DaemonClient, "fetchRecentProviderSessions" | "importAgent">,
  options?: RenderOptions,
) {
  mockSnapshot.current = {
    entries: options?.snapshot?.entries,
    supportsSnapshot: options?.snapshot?.supportsSnapshot ?? false,
  };

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const cwd = options && "cwd" in options ? (options.cwd ?? undefined) : "/repo/otto";

  return render(
    <QueryClientProvider client={queryClient}>
      <ImportSessionSheet
        visible={options?.visible ?? true}
        client={client}
        serverId="server-1"
        cwd={cwd}
        workspaceId={options?.workspaceId}
        onClose={options?.onClose ?? vi.fn()}
        onImportedAgent={options?.onImportedAgent ?? vi.fn()}
        onImported={options?.onImported}
      />
    </QueryClientProvider>,
  );
}

function createRecentSessionsClient(
  fetchRecentProviderSessions: Pick<
    DaemonClient,
    "fetchRecentProviderSessions"
  >["fetchRecentProviderSessions"],
  importAgent: Pick<DaemonClient, "importAgent">["importAgent"],
): Pick<DaemonClient, "fetchRecentProviderSessions" | "importAgent"> {
  return { fetchRecentProviderSessions, importAgent };
}

function createImportedAgentSnapshot(id: string): Awaited<ReturnType<DaemonClient["importAgent"]>> {
  return {
    id,
    provider: "custom-provider",
    cwd: "/repo/otto",
    model: null,
    createdAt: "2026-04-30T10:00:00.000Z",
    updatedAt: "2026-04-30T10:00:00.000Z",
    lastUserMessageAt: "2026-04-30T10:00:00.000Z",
    status: "idle",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
  };
}

function createProviderSessionEntry(
  overrides?: Partial<FetchRecentProviderSessionEntry>,
): FetchRecentProviderSessionEntry {
  return {
    providerId: "custom-provider",
    providerLabel: "Custom Agent",
    providerHandleId: "provider-thread-1",
    cwd: "/repo/otto",
    title: "Import me",
    firstPromptPreview: "Import this external provider session",
    lastPromptPreview: "Import this external provider session",
    lastActivityAt: "2026-04-30T10:00:00.000Z",
    ...overrides,
  };
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

function createSnapshotEntry(
  provider: string,
  overrides?: Partial<ProviderSnapshotEntry>,
): ProviderSnapshotEntry {
  return {
    provider,
    status: "ready",
    enabled: true,
    label: PROVIDER_LABELS[provider] ?? provider,
    ...overrides,
  };
}

describe("ImportSessionSheet", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows an update-host message when the daemon does not support provider snapshots", async () => {
    const fetchRecentProviderSessions = vi.fn();
    const importAgent = vi.fn();

    renderSheet({ fetchRecentProviderSessions, importAgent } as Pick<
      DaemonClient,
      "fetchRecentProviderSessions" | "importAgent"
    >);

    await screen.findByText("Update the host to import sessions.");
    expect(fetchRecentProviderSessions).not.toHaveBeenCalled();
  });

  it("shows a loading state while provider snapshot is loading", async () => {
    const fetchRecentProviderSessions = vi.fn(
      () => new Promise<Awaited<ReturnType<DaemonClient["fetchRecentProviderSessions"]>>>(() => {}),
    );
    const importAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        snapshot: { supportsSnapshot: true, entries: undefined },
      },
    );

    await screen.findByText("Loading recent sessions...");
    expect(fetchRecentProviderSessions).not.toHaveBeenCalled();
  });

  it("shows an empty state when there are no recent provider sessions to import", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent-provider-sessions",
      entries: [],
    }));
    const importAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
      },
    );

    await screen.findByText("No recent sessions to import.");
  });

  it("shows the all-already-imported empty state when filteredAlreadyImportedCount is positive", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent-provider-sessions",
      entries: [],
      filteredAlreadyImportedCount: 3,
    }));
    const importAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
      },
    );

    await screen.findByText("All recent sessions are already imported.");
    expect(screen.queryByText("No recent sessions to import.")).toBeNull();
  });

  it("shows a fetch error state when recent provider sessions cannot be loaded", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => {
      throw new Error("recent sessions unavailable");
    });
    const importAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
      },
    );

    await screen.findByText("Could not load recent sessions.");
  });

  it("loads recent provider sessions for the workspace and renders descriptor-owned labels", async () => {
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent-provider-sessions",
      entries: [
        createProviderSessionEntry({
          providerId: "claude",
          providerLabel: "Claude Code",
          title: null,
          firstPromptPreview: "Implement the importer sheet",
          lastPromptPreview: "Make the rows readable and provider opaque",
        }),
      ],
    }));
    const importAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
      },
    );

    await waitFor(() => {
      expect(fetchRecentProviderSessions).toHaveBeenCalledWith({
        cwd: "/repo/otto",
        providers: ["claude"],
        limit: 15,
      });
    });

    await screen.findByText("Implement the importer sheet");
    screen.getByText("2h ago");
    screen.getByText("Make the rows readable and provider opaque");
  });

  it("keeps cached rows visible and revalidates when reopened", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent-provider-sessions",
      entries: [
        createProviderSessionEntry({
          providerId: "claude",
          providerLabel: "Claude Code",
          title: "Cached importable session",
        }),
      ],
    }));
    const importAgent = vi.fn();
    const client = createRecentSessionsClient(fetchRecentProviderSessions, importAgent);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    mockSnapshot.current = {
      entries: [createSnapshotEntry("claude")],
      supportsSnapshot: true,
    };

    function TestSheet({ visible }: { visible: boolean }) {
      return (
        <QueryClientProvider client={queryClient}>
          <ImportSessionSheet
            visible={visible}
            client={client}
            serverId="server-1"
            cwd="/repo/otto"
            onClose={vi.fn()}
            onImportedAgent={vi.fn()}
          />
        </QueryClientProvider>
      );
    }

    const { rerender } = render(<TestSheet visible />);

    await screen.findByText("Cached importable session");
    expect(fetchRecentProviderSessions).toHaveBeenCalledTimes(1);

    rerender(<TestSheet visible={false} />);
    fetchRecentProviderSessions.mockClear();
    rerender(<TestSheet visible />);

    await screen.findByText("Cached importable session");
    await waitFor(() => {
      expect(fetchRecentProviderSessions).toHaveBeenCalledWith({
        cwd: "/repo/otto",
        providers: ["claude"],
        limit: 15,
      });
    });
  });

  it("imports a selected session by provider handle and reports the imported agent", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent-provider-sessions",
      entries: [
        createProviderSessionEntry({
          providerId: "claude",
          providerLabel: "Claude Code",
          cwd: "/repo/otto-realpath",
        }),
      ],
    }));
    const importAgent = vi.fn(async () => createImportedAgentSnapshot("agent-imported"));
    const onClose = vi.fn();
    const onImportedAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        onClose,
        onImportedAgent,
        snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
      },
    );

    fireEvent.click(await screen.findByTestId("import-session-session-claude-provider-thread-1"));
    fireEvent.click(screen.getByTestId("import-session-import-selected"));

    await waitFor(() => {
      expect(importAgent).toHaveBeenCalledWith({
        providerId: "claude",
        providerHandleId: "provider-thread-1",
        cwd: "/repo/otto-realpath",
      });
    });
    expect(onImportedAgent).toHaveBeenCalledWith("agent-imported");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an import error state without closing when selected session import fails", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent-provider-sessions",
      entries: [createProviderSessionEntry({ providerId: "claude", providerLabel: "Claude Code" })],
    }));
    const importAgent = vi.fn(async () => {
      throw new Error("import unavailable");
    });
    const onClose = vi.fn();
    const onImportedAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        onClose,
        onImportedAgent,
        snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
      },
    );

    fireEvent.click(await screen.findByTestId("import-session-session-claude-provider-thread-1"));
    fireEvent.click(screen.getByTestId("import-session-import-selected"));

    await screen.findByText("Some sessions could not be imported. Retry the failed selections.");
    expect(importAgent).toHaveBeenCalledWith({
      providerId: "claude",
      providerHandleId: "provider-thread-1",
      cwd: "/repo/otto",
    });
    expect(onImportedAgent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fans out one request per enabled provider when snapshot is supported", async () => {
    const fetchRecentProviderSessions = vi.fn(
      async (options: { providers?: string[] } | undefined) => ({
        requestId: `recent-${options?.providers?.[0] ?? "all"}`,
        entries: [
          createProviderSessionEntry({
            providerId: options?.providers?.[0] ?? "custom-provider",
            providerLabel: options?.providers?.[0] ?? "Custom",
            providerHandleId: `${options?.providers?.[0] ?? "custom-provider"}-thread`,
            title: `Session ${options?.providers?.[0] ?? "all"}`,
            lastActivityAt: "2026-04-30T10:00:00.000Z",
          }),
        ],
      }),
    );
    const importAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        snapshot: {
          supportsSnapshot: true,
          entries: [
            createSnapshotEntry("claude"),
            createSnapshotEntry("codex"),
            createSnapshotEntry("opencode", { enabled: false }),
            createSnapshotEntry("z-ai"),
          ],
        },
      },
    );

    await waitFor(() => {
      expect(fetchRecentProviderSessions).toHaveBeenCalledWith({
        cwd: "/repo/otto",
        providers: ["claude"],
        limit: 15,
      });
    });
    expect(fetchRecentProviderSessions).toHaveBeenCalledWith({
      cwd: "/repo/otto",
      providers: ["codex"],
      limit: 15,
    });
    expect(fetchRecentProviderSessions).not.toHaveBeenCalledWith(
      expect.objectContaining({ providers: ["opencode"] }),
    );
    expect(fetchRecentProviderSessions).toHaveBeenCalledWith({
      cwd: "/repo/otto",
      providers: ["z-ai"],
      limit: 15,
    });

    await screen.findByText("Session claude");
    await screen.findByText("Session codex");
    await screen.findByText("Session z-ai");
  });

  it("shows partial-failure note when one provider request fails but others succeed", async () => {
    const fetchRecentProviderSessions = vi.fn(
      async (options: { providers?: string[] } | undefined) => {
        const provider = options?.providers?.[0];
        if (provider === "claude") {
          throw new Error("claude offline");
        }
        return {
          requestId: `recent-${provider ?? "all"}`,
          entries: [
            createProviderSessionEntry({
              providerId: provider ?? "custom-provider",
              providerHandleId: `${provider}-thread`,
              providerLabel: provider ?? "Custom",
              title: `Session ${provider}`,
            }),
          ],
        };
      },
    );
    const importAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        snapshot: {
          supportsSnapshot: true,
          entries: [createSnapshotEntry("claude"), createSnapshotEntry("codex")],
        },
      },
    );

    await screen.findByText("Session codex");
    await screen.findByText("Could not load sessions for Claude Code.");
  });

  it("filters the merged list when a provider badge is selected and restores it on All", async () => {
    const fetchRecentProviderSessions = vi.fn(
      async (options: { providers?: string[] } | undefined) => {
        const provider = options?.providers?.[0] ?? "claude";
        return {
          requestId: `recent-${provider}`,
          entries: [
            createProviderSessionEntry({
              providerId: provider,
              providerLabel: provider === "claude" ? "Claude Code" : "Codex",
              providerHandleId: `${provider}-thread`,
              title: `Session ${provider}`,
              lastActivityAt:
                provider === "claude" ? "2026-04-30T09:00:00.000Z" : "2026-04-30T10:00:00.000Z",
            }),
          ],
        };
      },
    );
    const importAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        snapshot: {
          supportsSnapshot: true,
          entries: [createSnapshotEntry("claude"), createSnapshotEntry("codex")],
        },
      },
    );

    await screen.findByText("Session claude");
    await screen.findByText("Session codex");

    fireEvent.click(screen.getByTestId("import-session-filter-trigger"));
    fireEvent.click(screen.getByTestId("import-session-filter-codex"));

    screen.getByText("Session codex");
    expect(screen.queryByText("Session claude")).toBeNull();

    fireEvent.click(screen.getByTestId("import-session-filter-trigger"));
    fireEvent.click(screen.getByTestId("import-session-filter-all"));

    screen.getByText("Session claude");
    screen.getByText("Session codex");
  });

  it("does not render filter badges when only one importable provider is enabled", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent-codex",
      entries: [createProviderSessionEntry({ providerId: "codex", providerLabel: "Codex" })],
    }));
    const importAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        snapshot: {
          supportsSnapshot: true,
          entries: [
            createSnapshotEntry("codex"),
            createSnapshotEntry("claude", { enabled: false }),
          ],
        },
      },
    );

    await waitFor(() => {
      expect(fetchRecentProviderSessions).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("import-session-filters")).toBeNull();
    expect(screen.queryByTestId("import-session-filter-all")).toBeNull();
  });

  it("shows a no-importable-providers message when snapshot has no enabled providers", async () => {
    const fetchRecentProviderSessions = vi.fn();
    const importAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        snapshot: {
          supportsSnapshot: true,
          entries: [
            createSnapshotEntry("claude", { enabled: false }),
            createSnapshotEntry("codex", { enabled: false }),
            createSnapshotEntry("opencode", { enabled: false }),
            createSnapshotEntry("z-ai", { enabled: false }),
          ],
        },
      },
    );

    await screen.findByText("No importable providers are enabled.");
    expect(fetchRecentProviderSessions).not.toHaveBeenCalled();
  });

  it("omits cwd from fetch and renders the session cwd on each row when cwd is unset", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent-provider-sessions",
      entries: [
        createProviderSessionEntry({
          providerId: "claude",
          providerLabel: "Claude Code",
          cwd: "/home/me/work/other-project",
          title: "Cross-project session",
        }),
      ],
    }));
    const importAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        cwd: null,
        snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
      },
    );

    await waitFor(() => {
      expect(fetchRecentProviderSessions).toHaveBeenCalledWith({
        providers: ["claude"],
        limit: 15,
      });
    });
    expect(fetchRecentProviderSessions).not.toHaveBeenCalledWith(
      expect.objectContaining({ cwd: expect.anything() }),
    );
    await screen.findByText("/home/me/work/other-project");
  });

  it("uses the session's cwd when importing in cwd-less mode and fires onImported", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent-provider-sessions",
      entries: [
        createProviderSessionEntry({
          providerId: "claude",
          providerLabel: "Claude Code",
          cwd: "/home/me/work/other-project",
        }),
      ],
    }));
    const importAgent = vi.fn(async () => createImportedAgentSnapshot("agent-imported"));
    const onImported = vi.fn();
    const onImportedAgent = vi.fn();
    const onClose = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        cwd: null,
        onClose,
        onImported,
        onImportedAgent,
        snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
      },
    );

    fireEvent.click(await screen.findByTestId("import-session-session-claude-provider-thread-1"));
    fireEvent.click(screen.getByTestId("import-session-import-selected"));

    await waitFor(() => {
      expect(importAgent).toHaveBeenCalledWith({
        providerId: "claude",
        providerHandleId: "provider-thread-1",
        cwd: "/home/me/work/other-project",
      });
    });
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: "agent-imported" }));
    expect(onImportedAgent).toHaveBeenCalledWith("agent-imported");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refetches sessions when the refresh button is clicked", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent-provider-sessions",
      entries: [
        createProviderSessionEntry({
          providerId: "claude",
          providerLabel: "Claude Code",
          title: "Refreshable session",
        }),
      ],
    }));
    const importAgent = vi.fn();

    renderSheet(
      { fetchRecentProviderSessions, importAgent } as Pick<
        DaemonClient,
        "fetchRecentProviderSessions" | "importAgent"
      >,
      {
        snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
      },
    );

    await screen.findByText("Refreshable session");
    expect(fetchRecentProviderSessions).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("import-session-refresh"));

    await waitFor(() => {
      expect(fetchRecentProviderSessions).toHaveBeenCalledTimes(2);
    });
  });
  it("discovers foreign folders on the same host and imports without the current workspace target", async () => {
    const local = createProviderSessionEntry({
      providerId: "codex",
      providerHandleId: "local",
      cwd: "/repo/otto",
      title: "Local chat",
    });
    const foreign = createProviderSessionEntry({
      providerId: "codex",
      providerHandleId: "foreign",
      cwd: "/documents/codex/test",
      title: "Review test response",
    });
    const fetchRecentProviderSessions = vi.fn(async (options?: { cwd?: string }) => ({
      requestId: "recent",
      entries: options?.cwd ? [local] : [local, foreign],
    }));
    const importAgent = vi.fn(async () => ({
      ...createImportedAgentSnapshot("imported-foreign"),
      cwd: foreign.cwd,
      workspaceId: "foreign-workspace",
    }));
    const onImportedAgent = vi.fn();
    renderSheet(createRecentSessionsClient(fetchRecentProviderSessions, importAgent), {
      workspaceId: "current-workspace",
      onImportedAgent,
      snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("codex")] },
    });
    fireEvent.click(await screen.findByTestId("import-session-session-codex-local"));
    expect(importAgent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("import-session-all-projects"));
    await screen.findByText("Review test response");
    expect(fetchRecentProviderSessions).toHaveBeenLastCalledWith({
      providers: ["codex"],
      limit: 15,
    });
    expect(
      screen.getByTestId("import-session-session-codex-local").getAttribute("aria-checked"),
    ).toBe("false");
    screen.getByText(foreign.cwd);
    fireEvent.click(screen.getByTestId("import-session-session-codex-foreign"));
    fireEvent.click(screen.getByTestId("import-session-import-selected"));
    await waitFor(() =>
      expect(importAgent).toHaveBeenCalledWith({
        providerId: "codex",
        providerHandleId: "foreign",
        cwd: foreign.cwd,
      }),
    );
    expect(onImportedAgent).not.toHaveBeenCalled();
  });

  it("imports selected sessions sequentially, keeps failures selected, and does not retry successes", async () => {
    const entries = ["one", "two", "three"].map((id) =>
      createProviderSessionEntry({ providerId: "codex", providerHandleId: id, title: id }),
    );
    const fetchRecentProviderSessions = vi.fn(async () => ({ requestId: "recent", entries }));
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let failSecond = true;
    const importAgent = vi.fn(async (input: Parameters<DaemonClient["importAgent"]>[0]) => {
      const providerHandleId =
        "providerHandleId" in input ? input.providerHandleId : input.sessionId;
      if (providerHandleId === "one") await first;
      if (providerHandleId === "two" && failSecond) throw new Error("Session is busy");
      return createImportedAgentSnapshot(providerHandleId);
    });
    const onClose = vi.fn();
    renderSheet(createRecentSessionsClient(fetchRecentProviderSessions, importAgent), {
      onClose,
      snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("codex")] },
    });
    fireEvent.click(await screen.findByTestId("import-session-select-all"));
    fireEvent.click(screen.getByTestId("import-session-import-selected"));
    await waitFor(() => expect(importAgent).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("import-session-import-selected").hasAttribute("disabled")).toBe(
      true,
    );
    expect(onClose).not.toHaveBeenCalled();
    resolveFirst();
    await screen.findByText("Session is busy");
    expect(
      importAgent.mock.calls.map(([input]) =>
        "providerHandleId" in input ? input.providerHandleId : input.sessionId,
      ),
    ).toEqual(["one", "two", "three"]);
    expect(screen.queryByTestId("import-session-session-codex-one")).toBeNull();
    expect(screen.queryByTestId("import-session-session-codex-three")).toBeNull();
    expect(
      screen.getByTestId("import-session-session-codex-two").getAttribute("aria-checked"),
    ).toBe("true");
    expect(onClose).not.toHaveBeenCalled();
    failSecond = false;
    fireEvent.click(screen.getByTestId("import-session-import-selected"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(
      importAgent.mock.calls.map(([input]) =>
        "providerHandleId" in input ? input.providerHandleId : input.sessionId,
      ),
    ).toEqual(["one", "two", "three", "two"]);
  });

  it("selects only the visible provider and keeps scoped imports in the requesting workspace", async () => {
    const fetchRecentProviderSessions = vi.fn(async (options?: { providers?: string[] }) => ({
      requestId: "recent",
      entries: [
        createProviderSessionEntry({
          providerId: options?.providers?.[0] ?? "codex",
          title: options?.providers?.[0],
        }),
      ],
    }));
    const importAgent = vi.fn(async () => ({
      ...createImportedAgentSnapshot("imported"),
      workspaceId: "current-workspace",
    }));
    renderSheet(createRecentSessionsClient(fetchRecentProviderSessions, importAgent), {
      workspaceId: "current-workspace",
      snapshot: {
        supportsSnapshot: true,
        entries: [createSnapshotEntry("codex"), createSnapshotEntry("claude")],
      },
    });
    await screen.findByTestId("import-session-session-codex-provider-thread-1");
    fireEvent.click(screen.getByTestId("import-session-select-all"));
    fireEvent.click(screen.getByTestId("import-session-filter-trigger"));
    fireEvent.click(screen.getByTestId("import-session-filter-codex"));
    expect(screen.getByTestId("import-session-import-selected").hasAttribute("disabled")).toBe(
      true,
    );
    fireEvent.click(screen.getByTestId("import-session-select-all"));
    fireEvent.click(screen.getByTestId("import-session-import-selected"));
    await waitFor(() => expect(importAgent).toHaveBeenCalledTimes(1));
    expect(importAgent).toHaveBeenCalledWith({
      providerId: "codex",
      providerHandleId: "provider-thread-1",
      cwd: "/repo/otto",
      workspaceId: "current-workspace",
    });
  });

  it("can load older sessions beyond the initial list", async () => {
    const entries = Array.from({ length: 30 }, (_, index) =>
      createProviderSessionEntry({
        providerId: "codex",
        providerHandleId: String(index),
        title: `Chat ${index}`,
      }),
    );
    const fetchRecentProviderSessions = vi.fn(async (options?: { limit?: number }) => ({
      requestId: "recent",
      entries: entries.slice(0, options?.limit ?? 15),
    }));
    renderSheet(createRecentSessionsClient(fetchRecentProviderSessions, vi.fn()), {
      snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("codex")] },
    });
    fireEvent.click(await screen.findByTestId("import-session-load-more"));
    await screen.findByText("Chat 29");
    expect(fetchRecentProviderSessions).toHaveBeenLastCalledWith({
      providers: ["codex"],
      cwd: "/repo/otto",
      limit: 30,
    });
  });
});
