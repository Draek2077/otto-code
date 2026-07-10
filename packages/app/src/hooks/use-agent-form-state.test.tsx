/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import { useAgentFormState } from "./use-agent-form-state";

const mocks = vi.hoisted(() => ({
  snapshot: {
    entries: undefined as ProviderSnapshotEntry[] | undefined,
    isLoading: false,
    isRefreshing: false,
    error: null as string | null,
    refresh: vi.fn(async () => {}),
    refetchIfStale: vi.fn(),
  },
  preferences: {
    preferences: {} as FormPreferences,
    isLoading: false,
    updatePreferences: vi.fn(async () => {}),
  },
}));

vi.mock("./use-providers-snapshot", () => ({
  useProvidersSnapshot: (serverId: string | null) => ({
    ...mocks.snapshot,
    // Mirror the real hook: no data until there is a host to ask.
    entries: serverId ? mocks.snapshot.entries : undefined,
  }),
}));

vi.mock("./use-form-preferences", async () => {
  const preferences = await import("@/create-agent-preferences/preferences");
  return {
    buildFavoriteModelKey: preferences.buildFavoriteModelKey,
    isFavoriteModel: preferences.isFavoriteModel,
    mergeProviderPreferences: preferences.mergeProviderPreferences,
    toggleFavoriteModel: preferences.toggleFavoriteModel,
    useFormPreferences: () => mocks.preferences,
  };
});

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "host-a", label: "Host A" }],
}));

const READY_ENTRIES: ProviderSnapshotEntry[] = [
  {
    provider: "mock",
    label: "Mock",
    status: "ready",
    enabled: true,
    fetchedAt: "2026-07-01T00:00:00.000Z",
    models: [
      {
        provider: "mock",
        id: "model-a",
        label: "Model A",
        isDefault: true,
        defaultThinkingOptionId: "high",
        thinkingOptions: [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
      {
        provider: "mock",
        id: "model-b",
        label: "Model B",
        thinkingOptions: [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
    ],
  },
];

const ERRORED_ENTRIES: ProviderSnapshotEntry[] = [
  {
    provider: "mock",
    label: "Mock",
    status: "error",
    enabled: true,
    fetchedAt: "2026-07-01T00:00:00.000Z",
    error: "endpoint unreachable",
  },
];

const SAVED_PREFERENCES: FormPreferences = {
  provider: "mock",
  providerPreferences: {
    mock: { model: "model-b", thinkingByModel: { "model-b": "low" } },
  },
};

// The artifact create sheet's exact usage: mounted closed, opened globally
// (no initial server/project), host auto-selected from online servers.
function renderArtifactStyleForm() {
  return renderHook(
    ({ visible }: { visible: boolean }) =>
      useAgentFormState({
        initialServerId: null,
        initialValues: undefined,
        isVisible: visible,
        isCreateFlow: true,
        onlineServerIds: ["host-a"],
      }),
    { initialProps: { visible: false } },
  );
}

describe("useAgentFormState (create-sheet open flow)", () => {
  beforeEach(() => {
    mocks.snapshot.entries = undefined;
    mocks.preferences.preferences = SAVED_PREFERENCES;
    mocks.preferences.isLoading = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("preselects the last-used provider and model when opened with no project", async () => {
    mocks.snapshot.entries = READY_ENTRIES;
    const { result, rerender } = renderArtifactStyleForm();

    rerender({ visible: true });
    // The artifact sheet re-seeds host + cwd from props on open.
    act(() => {
      result.current.setSelectedServerId(null);
      result.current.setWorkingDir("");
    });

    await waitFor(() => {
      expect(result.current.selectedServerId).toBe("host-a");
      expect(result.current.selectedProvider).toBe("mock");
    });
    expect(result.current.selectedModel).toBe("model-b");
    expect(result.current.selectedThinkingOptionId).toBe("low");
  });

  it("preselects once the provider snapshot arrives after opening", async () => {
    const { result, rerender } = renderArtifactStyleForm();

    rerender({ visible: true });
    act(() => {
      result.current.setSelectedServerId(null);
      result.current.setWorkingDir("");
    });
    await waitFor(() => {
      expect(result.current.selectedServerId).toBe("host-a");
    });
    expect(result.current.selectedProvider).toBeNull();

    mocks.snapshot.entries = READY_ENTRIES;
    rerender({ visible: true });

    await waitFor(() => {
      expect(result.current.selectedProvider).toBe("mock");
    });
    expect(result.current.selectedModel).toBe("model-b");
  });

  it("recovers the preselection when the preferred provider heals after open", async () => {
    // A stale cached snapshot can hold the preferred provider in an error
    // state (e.g. a remote endpoint that was asleep). The form must not
    // settle on "no selection" — it re-resolves when fresh entries arrive.
    mocks.snapshot.entries = ERRORED_ENTRIES;
    const { result, rerender } = renderArtifactStyleForm();

    rerender({ visible: true });
    await waitFor(() => {
      expect(result.current.selectedServerId).toBe("host-a");
    });
    expect(result.current.selectedProvider).toBeNull();

    mocks.snapshot.entries = READY_ENTRIES;
    rerender({ visible: true });

    await waitFor(() => {
      expect(result.current.selectedProvider).toBe("mock");
    });
    expect(result.current.selectedModel).toBe("model-b");
  });

  it("does not override user selections when the snapshot refreshes", async () => {
    mocks.snapshot.entries = READY_ENTRIES;
    const { result, rerender } = renderArtifactStyleForm();

    rerender({ visible: true });
    await waitFor(() => {
      expect(result.current.selectedModel).toBe("model-b");
    });

    act(() => {
      result.current.setProviderAndModelFromUser("mock", "model-a");
    });
    expect(result.current.selectedModel).toBe("model-a");

    // A snapshot refresh (same data, new identity) must keep the user's pick.
    mocks.snapshot.entries = READY_ENTRIES.map((entry) => ({ ...entry }));
    rerender({ visible: true });

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("model-a");
    });
  });

  it("re-resolves from preferences on each reopen", async () => {
    mocks.snapshot.entries = READY_ENTRIES;
    const { result, rerender } = renderArtifactStyleForm();

    rerender({ visible: true });
    await waitFor(() => {
      expect(result.current.selectedModel).toBe("model-b");
    });

    rerender({ visible: false });
    rerender({ visible: true });

    await waitFor(() => {
      expect(result.current.selectedProvider).toBe("mock");
      expect(result.current.selectedModel).toBe("model-b");
    });
  });
});
