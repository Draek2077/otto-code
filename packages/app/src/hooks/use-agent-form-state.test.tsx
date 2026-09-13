/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormPreferenceUpdate } from "@/create-agent-preferences/service";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import { materializeAgentProfile } from "@/agent-profiles/internal/materialize-profile";
import { useAgentFormState } from "./use-agent-form-state";

const mocks = vi.hoisted(() => ({
  snapshotRequests: vi.fn(),
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
    updatePreferences: vi.fn<(updates: FormPreferenceUpdate) => Promise<FormPreferences>>(),
  },
}));

vi.mock("./use-providers-snapshot", () => ({
  useProvidersSnapshot: (serverId: string | null, options: { cwd: string }) => {
    mocks.snapshotRequests(serverId, options);
    return {
      ...mocks.snapshot,
      // Mirror the real hook: no data until there is a host to ask.
      entries: serverId ? mocks.snapshot.entries : undefined,
    };
  },
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

// The caller owns the selected host and directory, including an empty global directory.
function renderArtifactStyleForm() {
  return renderHook(
    ({ visible }: { visible: boolean }) =>
      useAgentFormState({
        serverId: "host-a",
        workingDir: "",
        initialValues: undefined,
        isVisible: visible,
        isCreateFlow: true,
      }),
    { initialProps: { visible: false } },
  );
}

describe("useAgentFormState (create-sheet open flow)", () => {
  beforeEach(() => {
    mocks.snapshot.entries = undefined;
    mocks.preferences.preferences = SAVED_PREFERENCES;
    mocks.preferences.isLoading = false;
    mocks.preferences.updatePreferences.mockImplementation(async (updates) => {
      const next =
        typeof updates === "function"
          ? updates(mocks.preferences.preferences)
          : { ...mocks.preferences.preferences, ...updates };
      mocks.preferences.preferences = next;
      return next;
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("preselects the last-used provider and model when opened with no project", async () => {
    mocks.snapshot.entries = READY_ENTRIES;
    const { result, rerender } = renderArtifactStyleForm();

    rerender({ visible: true });

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

  it("retains saved intent throughout provider failure and recovery", async () => {
    // A stale cached snapshot can hold the preferred provider in an error
    // state (e.g. a remote endpoint that was asleep). The form must not
    // settle on "no selection" - it re-resolves when fresh entries arrive.
    mocks.snapshot.entries = ERRORED_ENTRIES;
    const { result, rerender } = renderArtifactStyleForm();

    rerender({ visible: true });
    await waitFor(() => {
      expect(result.current.selectedServerId).toBe("host-a");
    });
    expect(result.current.selectedProvider).toBe("mock");
    expect(result.current.selectedModel).toBe("model-b");

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

  it("falls back to the provider default when nothing is remembered", async () => {
    // Tier 4. The form must actually HOLD the default, not leave model empty
    // and let the trigger label paint it in.
    mocks.preferences.preferences = { provider: "mock" };
    mocks.snapshot.entries = READY_ENTRIES;
    const { result, rerender } = renderArtifactStyleForm();

    rerender({ visible: true });

    await waitFor(() => {
      expect(result.current.selectedProvider).toBe("mock");
    });
    expect(result.current.selectedModel).toBe("model-a");
  });

  it("persists a model the user picked by hand", async () => {
    mocks.snapshot.entries = READY_ENTRIES;
    const { result, rerender } = renderArtifactStyleForm();

    rerender({ visible: true });
    await waitFor(() => {
      expect(result.current.selectedProvider).toBe("mock");
    });
    mocks.preferences.updatePreferences.mockClear();

    act(() => {
      result.current.setModelFromUser("model-a");
    });

    expect(mocks.preferences.updatePreferences).toHaveBeenCalled();
  });

  it("does not persist a model applied by a personality", async () => {
    // The whole point of the ladder: a personality OUTRANKS the last-used model
    // preference, so writing itself into that preference would erase the tier it
    // beats and then read back as the user's own pick.
    mocks.snapshot.entries = READY_ENTRIES;
    const { result, rerender } = renderArtifactStyleForm();

    rerender({ visible: true });
    await waitFor(() => {
      expect(result.current.selectedProvider).toBe("mock");
    });
    mocks.preferences.updatePreferences.mockClear();

    act(() => {
      result.current.applyPersonalityValues({
        provider: "mock",
        model: "model-a",
        modeId: "",
        thinkingOptionId: "low",
      });
    });

    expect(result.current.selectedModel).toBe("model-a");
    expect(result.current.selectedThinkingOptionId).toBe("low");
    expect(mocks.preferences.updatePreferences).not.toHaveBeenCalled();

    // Submitting under that personality must not persist it either.
    await act(async () => {
      await result.current.persistFormPreferences();
    });
    expect(mocks.preferences.updatePreferences).not.toHaveBeenCalled();
  });

  it("resumes persisting once the user overrides the personality's model", async () => {
    mocks.snapshot.entries = READY_ENTRIES;
    const { result, rerender } = renderArtifactStyleForm();

    rerender({ visible: true });
    await waitFor(() => {
      expect(result.current.selectedProvider).toBe("mock");
    });

    act(() => {
      result.current.applyPersonalityValues({
        provider: "mock",
        model: "model-a",
        modeId: "",
        thinkingOptionId: "low",
      });
    });
    mocks.preferences.updatePreferences.mockClear();

    act(() => {
      result.current.setModelFromUser("model-b");
    });

    expect(mocks.preferences.updatePreferences).toHaveBeenCalled();
  });

  it("binds one canonical profile id until the user picks a raw model", async () => {
    mocks.snapshot.entries = READY_ENTRIES;
    const { result, rerender } = renderArtifactStyleForm();

    rerender({ visible: true });
    await waitFor(() => {
      expect(result.current.selectedProvider).toBe("mock");
    });

    const profile = materializeAgentProfile({
      id: "profile-coder",
      name: "Coder",
      provider: "mock",
      model: "model-a",
      thinkingOptionId: "low",
      personalityPrompt: "Stay focused.",
      roles: ["coder"],
      spinner: { glowA: "violet", glowB: "blue" },
    });
    act(() => {
      result.current.applyProfileFromUser(profile);
    });

    expect(result.current.selectedAgentProfileId).toBe("profile-coder");
    expect(result.current.selectedAgentProfile).toBe(profile);
    expect(result.current.selectedModel).toBe("model-a");
    expect(result.current.selectedThinkingOptionId).toBe("low");

    act(() => {
      result.current.setModelFromUser("model-b");
    });
    expect(result.current.selectedAgentProfileId).toBeNull();
    expect(result.current.selectedAgentProfile).toBeNull();
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

describe("caller-owned form execution context", () => {
  beforeEach(() => {
    mocks.preferences.updatePreferences.mockImplementation(async (updates) => {
      const next =
        typeof updates === "function"
          ? updates(mocks.preferences.preferences)
          : { ...mocks.preferences.preferences, ...updates };
      mocks.preferences.preferences = next;
      return next;
    });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses the caller host and directory on the first render and never invents a host", () => {
    mocks.snapshot.entries = READY_ENTRIES;
    mocks.preferences.preferences = SAVED_PREFERENCES;
    const { result, rerender } = renderHook(
      ({ serverId, workingDir }: { serverId: string | null; workingDir: string }) =>
        useAgentFormState({ serverId, workingDir }),
      { initialProps: { serverId: null as string | null, workingDir: "C:/project" } },
    );
    expect(result.current.selectedServerId).toBeNull();
    expect(mocks.snapshotRequests).toHaveBeenNthCalledWith(1, null, { cwd: "C:/project" });
    rerender({ serverId: "host-a", workingDir: "C:/project" });
    expect(result.current.selectedServerId).toBe("host-a");
    expect(result.current.workingDir).toBe("C:/project");
    expect(mocks.snapshotRequests).toHaveBeenLastCalledWith("host-a", { cwd: "C:/project" });
  });

  it("keeps applied personality values and persistence isolation through cwd discovery changes", () => {
    mocks.snapshot.entries = READY_ENTRIES;
    mocks.preferences.preferences = SAVED_PREFERENCES;
    const { result, rerender } = renderHook(
      ({ workingDir }) => useAgentFormState({ serverId: "host-a", workingDir }),
      { initialProps: { workingDir: "" } },
    );
    act(() =>
      result.current.applyPersonalityValues({
        provider: "mock",
        model: "model-a",
        thinkingOptionId: "low",
      }),
    );
    mocks.preferences.updatePreferences.mockClear();
    mocks.snapshot.entries = undefined;
    rerender({ workingDir: "C:/project" });
    mocks.snapshot.entries = READY_ENTRIES;
    rerender({ workingDir: "C:/project" });
    expect(result.current.selectedModel).toBe("model-a");
    expect(result.current.selectedThinkingOptionId).toBe("low");
    expect(mocks.preferences.updatePreferences).not.toHaveBeenCalled();
  });

  it("exposes plugin providers and filters hidden Brain/local models without changing saved intent", () => {
    mocks.snapshot.entries = [
      {
        provider: "plugin.custom",
        label: "Plugin Agent",
        status: "ready",
        enabled: true,
        models: [{ provider: "plugin.custom", id: "visible", label: "Visible" }],
      },
      {
        provider: "otto-brain",
        label: "Otto Brain",
        status: "ready",
        enabled: true,
        models: [
          {
            provider: "otto-brain",
            id: "visible",
            label: "Visible",
            thinkingOptions: [{ id: "high", label: "High" }],
          },
          { provider: "otto-brain", id: "hidden", label: "Hidden", isVisible: false },
        ],
      },
    ];
    mocks.preferences.preferences = {
      provider: "otto-brain",
      providerPreferences: { "otto-brain": { model: "hidden" } },
    };
    const { result } = renderHook(() => useAgentFormState({ serverId: "host-a", workingDir: "" }));
    expect(result.current.selectedModel).toBe("hidden");
    expect(result.current.allProviderModels.get("otto-brain")?.map((model) => model.id)).toEqual([
      "visible",
    ]);
    expect(result.current.modelSelectorProviders.map((provider) => provider.id)).toContain(
      "plugin.custom",
    );
    act(() => result.current.setProviderAndModelFromUser("plugin.custom", "visible"));
    expect(result.current.selectedProvider).toBe("plugin.custom");
    expect(result.current.selectedModel).toBe("visible");
  });
});

it("restores a model's just-selected effort before preference persistence settles", async () => {
  mocks.snapshot.entries = READY_ENTRIES;
  mocks.preferences.preferences = SAVED_PREFERENCES;
  let stored = SAVED_PREFERENCES;
  const pending: Array<() => void> = [];
  mocks.preferences.updatePreferences.mockImplementation(
    (updates) =>
      new Promise((resolve) => {
        pending.push(() => {
          stored = typeof updates === "function" ? updates(stored) : { ...stored, ...updates };
          resolve(stored);
        });
      }),
  );
  const { result, unmount } = renderHook(() =>
    useAgentFormState({ serverId: "host-a", workingDir: "" }),
  );
  act(() => result.current.setModelFromUser("model-a"));
  act(() => result.current.setThinkingOptionFromUser("low"));
  act(() => result.current.setModelFromUser("model-b"));
  act(() => result.current.setModelFromUser("model-a"));
  expect(result.current.selectedThinkingOptionId).toBe("low");
  await act(async () => {
    for (const commit of pending) commit();
  });
  unmount();
});
