/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import type { AgentPersonality, AgentTeam } from "@otto-code/protocol/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import type { PersonalityFormValues } from "@/provider-selection/personality-form";
import { useFormRolePersonality } from "./role-model-personality";

// The load-order cases this file exists for all hinge on WHEN each source
// arrives, so every dependency is a plain mutable mock the test re-points
// between rerenders — mirroring a daemon snapshot that lands "loading" first
// and "ready" second, a react-query cache that warms before the session store,
// and preferences that hydrate at their own pace.
const mocks = vi.hoisted(() => ({
  config: {
    config: null as {
      agentPersonalities?: { personalities?: unknown[] };
      agentTeams?: { teams?: unknown[]; activeTeamId?: string | null };
    } | null,
  },
  teamsFeature: { enabled: false },
  preferences: {
    preferences: {} as FormPreferences,
    isLoading: false,
    updatePreferences: vi.fn(async () => {}),
  },
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => mocks.config,
}));

vi.mock("@/screens/settings/agent-teams-section", () => ({
  useAgentTeamsFeature: () => mocks.teamsFeature.enabled,
}));

vi.mock("@/hooks/use-form-preferences", async () => {
  const preferences = await import("@/create-agent-preferences/preferences");
  return {
    buildFavoriteModelKey: preferences.buildFavoriteModelKey,
    isFavoriteModel: preferences.isFavoriteModel,
    mergeProviderPreferences: preferences.mergeProviderPreferences,
    toggleFavoriteModel: preferences.toggleFavoriteModel,
    useFormPreferences: () => mocks.preferences,
  };
});

const MODEL = {
  provider: "mock",
  id: "model-a",
  label: "Model A",
  isDefault: true,
};

// The daemon's first snapshot for a cwd: the provider is known but still
// warming, so nothing bound to it can resolve yet.
const LOADING_ENTRIES: ProviderSnapshotEntry[] = [
  {
    provider: "mock",
    label: "Mock",
    status: "loading",
    enabled: true,
    fetchedAt: "2026-07-20T00:00:00.000Z",
    models: [],
  },
];

const READY_ENTRIES: ProviderSnapshotEntry[] = [
  {
    provider: "mock",
    label: "Mock",
    status: "ready",
    enabled: true,
    fetchedAt: "2026-07-20T00:00:01.000Z",
    models: [MODEL],
  },
];

const CHATTER: AgentPersonality = {
  id: "p-chatter",
  name: "Chatty",
  provider: "mock",
  model: "model-a",
  roles: ["chatter"],
};

const OTHER_CHATTER: AgentPersonality = {
  id: "p-other",
  name: "Other",
  provider: "mock",
  model: "model-a",
  roles: ["chatter"],
};

// Carries a role this surface is NOT (the composer is "chatter"), so it only
// ever appears in the picker's grouped "All personalities" browse section.
const OFF_ROLE_CODER: AgentPersonality = {
  id: "p-coder",
  name: "Codey",
  provider: "mock",
  model: "model-a",
  roles: ["coder"],
};

const TEAM: AgentTeam = {
  id: "team-1",
  name: "Crew",
  memberIds: [CHATTER.id],
};

const TEAM_ENTRY_ID = "__team-chatter__";

function setConfig(input: { personalities: AgentPersonality[]; activeTeamId: string | null }) {
  mocks.config.config = {
    agentPersonalities: { personalities: input.personalities },
    agentTeams: { teams: [TEAM], activeTeamId: input.activeTeamId },
  };
}

interface HarnessProps {
  entries: readonly ProviderSnapshotEntry[];
  initialPersonalityId?: string | null;
}

function renderComposerPicker(initialProps: HarnessProps) {
  const onApply = vi.fn<(values: PersonalityFormValues) => void>();
  const view = renderHook(
    ({ entries, initialPersonalityId }: HarnessProps) =>
      useFormRolePersonality({
        serverId: "host-a",
        role: "chatter",
        entries,
        onApply,
        // What the form currently shows. The remembered-personality preselect
        // is match-gated against this, so it lines up with the roster entries.
        currentSelection: {
          provider: "mock",
          model: "model-a",
          modeId: "",
          thinkingOptionId: "",
        },
        team: { entryId: TEAM_ENTRY_ID, label: "Team's Chatter", roleLabel: "Chatter" },
        autoSelectDefault: "always",
        ...(initialPersonalityId === undefined ? {} : { initialPersonalityId }),
      }),
    { initialProps },
  );
  return { ...view, onApply };
}

describe("useFormRolePersonality (load order)", () => {
  beforeEach(() => {
    mocks.config.config = null;
    mocks.teamsFeature.enabled = false;
    mocks.preferences.preferences = {};
    mocks.preferences.isLoading = false;
    mocks.preferences.updatePreferences.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("applies the team's holder once the provider snapshot goes ready", async () => {
    // The bug: the one-shot default settled on the FIRST render where entries
    // existed, and the daemon's first snapshot has every provider "loading" —
    // so the team entry could not possibly resolve and the default never
    // retried. The draft ended with no personality at all.
    mocks.teamsFeature.enabled = true;
    setConfig({ personalities: [CHATTER], activeTeamId: TEAM.id });

    const { result, rerender, onApply } = renderComposerPicker({ entries: LOADING_ENTRIES });

    // Nothing resolves while the provider warms — and, critically, nothing settles.
    expect(result.current.selectedPersonalityId).toBeNull();
    expect(onApply).not.toHaveBeenCalled();

    rerender({ entries: READY_ENTRIES });

    await waitFor(() => {
      expect(result.current.selectedPersonalityId).toBe(TEAM_ENTRY_ID);
    });
    expect(result.current.spawnPersonalityId).toBe(CHATTER.id);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "mock", model: "model-a" }),
    );
  });

  it("falls to tier 2 once the snapshot is ready and no team resolves", async () => {
    // The other half of the same gate: "still loading" must retry, but a
    // settled snapshot resolves the ladder. With no team, a personality
    // carrying the role still outranks the device's last-used model — seeing a
    // bare model here would mean you have no Chatter at all.
    mocks.teamsFeature.enabled = true;
    setConfig({ personalities: [CHATTER], activeTeamId: null });

    const { result, rerender, onApply } = renderComposerPicker({ entries: LOADING_ENTRIES });
    expect(onApply).not.toHaveBeenCalled();
    rerender({ entries: READY_ENTRIES });

    await waitFor(() => {
      expect(result.current.selectedPersonalityId).toBe(CHATTER.id);
    });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "mock", model: "model-a" }),
    );
  });

  it("prefers the remembered personality over the first available one", async () => {
    // Tier 2's internal order: device memory picks WHICH personality, but it
    // never demotes the tier itself — that was the old bug, where a
    // non-matching memory dropped the whole surface through to the last-used
    // model.
    mocks.preferences.preferences = { lastPersonalityByRole: { chatter: OTHER_CHATTER.id } };
    setConfig({ personalities: [CHATTER, OTHER_CHATTER], activeTeamId: null });

    const { result } = renderComposerPicker({ entries: READY_ENTRIES });

    await waitFor(() => {
      expect(result.current.selectedPersonalityId).toBe(OTHER_CHATTER.id);
    });
  });

  it("does not persist a personality the default picked on the user's behalf", async () => {
    // lastPersonalityByRole means "what the user chose". An auto-pick writing
    // itself back would freeze "first available" in place the moment the roster
    // order changed.
    setConfig({ personalities: [CHATTER], activeTeamId: null });

    const { result } = renderComposerPicker({ entries: READY_ENTRIES });

    await waitFor(() => {
      expect(result.current.selectedPersonalityId).toBe(CHATTER.id);
    });
    expect(mocks.preferences.updatePreferences).not.toHaveBeenCalled();
  });

  it("lets a late team slot take over from the default's own tier-2 pick", async () => {
    // teamSlotLive's two inputs load from different sources (daemon config via
    // react-query, features.agentTeams via the session store), so the ladder can
    // legitimately settle on tier 2 and only then learn a team was active all
    // along. Tier 1 must still win — the default only steps aside for a USER
    // pick, never for its own earlier one.
    mocks.preferences.preferences = { lastPersonalityByRole: { chatter: OTHER_CHATTER.id } };
    setConfig({ personalities: [CHATTER, OTHER_CHATTER], activeTeamId: TEAM.id });

    const { result, rerender, onApply } = renderComposerPicker({ entries: READY_ENTRIES });

    await waitFor(() => {
      expect(result.current.selectedPersonalityId).toBe(CHATTER.id);
    });

    // The teams feature flag lands.
    act(() => {
      mocks.teamsFeature.enabled = true;
    });
    rerender({ entries: READY_ENTRIES });

    await waitFor(() => {
      expect(result.current.selectedPersonalityId).toBe(TEAM_ENTRY_ID);
    });
    expect(result.current.spawnPersonalityId).toBe(CHATTER.id);
    expect(onApply).toHaveBeenCalled();
  });

  it("keeps an explicit pick when the team slot goes live late", async () => {
    // The un-latch must only drop preselects. A pick the user made is theirs.
    setConfig({ personalities: [CHATTER, OTHER_CHATTER], activeTeamId: TEAM.id });

    const { result, rerender } = renderComposerPicker({ entries: READY_ENTRIES });

    act(() => {
      result.current.onSelectPersonality?.(OTHER_CHATTER.id);
    });
    expect(result.current.selectedPersonalityId).toBe(OTHER_CHATTER.id);

    act(() => {
      mocks.teamsFeature.enabled = true;
    });
    rerender({ entries: READY_ENTRIES });

    await waitFor(() => {
      expect(result.current.personalities?.[0]?.id).toBe(TEAM_ENTRY_ID);
    });
    expect(result.current.selectedPersonalityId).toBe(OTHER_CHATTER.id);
  });

  it("selects an off-role personality picked from the grouped browse section", async () => {
    // "All personalities" reaches the WHOLE roster, not just this surface's
    // role. Picking one there must bind that personality — not silently degrade
    // to "the model it happens to run".
    setConfig({ personalities: [CHATTER, OFF_ROLE_CODER], activeTeamId: null });

    const { result } = renderComposerPicker({ entries: READY_ENTRIES });

    await waitFor(() => {
      expect(result.current.selectedPersonalityId).toBe(CHATTER.id);
    });

    const group = result.current.personalityGroups?.find((entry) => entry.key === "all");
    expect(
      group?.roleGroups.flatMap((entry) => entry.personalities).map((entry) => entry.id),
    ).toContain(OFF_ROLE_CODER.id);

    act(() => {
      result.current.onSelectPersonality?.(OFF_ROLE_CODER.id);
    });

    expect(result.current.selectedPersonalityId).toBe(OFF_ROLE_CODER.id);
    expect(result.current.spawnPersonalityId).toBe(OFF_ROLE_CODER.id);
    expect(result.current.selectedName).toBe(OFF_ROLE_CODER.name);
  });

  it("keeps an inherited personality across a late team and a late snapshot", async () => {
    // Fork / "new tab from this agent": the setup now carries the source
    // agent's personality. Inheriting from a specific agent is a stronger
    // signal than either device memory or the active team's default, so
    // neither the un-latch nor the team default may overwrite it.
    mocks.teamsFeature.enabled = false;
    setConfig({ personalities: [CHATTER, OTHER_CHATTER], activeTeamId: TEAM.id });

    const { result, rerender, onApply } = renderComposerPicker({
      entries: LOADING_ENTRIES,
      initialPersonalityId: OTHER_CHATTER.id,
    });

    expect(result.current.selectedPersonalityId).toBe(OTHER_CHATTER.id);

    act(() => {
      mocks.teamsFeature.enabled = true;
    });
    rerender({ entries: READY_ENTRIES, initialPersonalityId: OTHER_CHATTER.id });

    await waitFor(() => {
      expect(result.current.personalities?.[0]?.id).toBe(TEAM_ENTRY_ID);
    });
    expect(result.current.selectedPersonalityId).toBe(OTHER_CHATTER.id);
    expect(result.current.spawnPersonalityId).toBe(OTHER_CHATTER.id);
    // Identity only — the fork's provider/model already arrive via initialValues.
    expect(onApply).not.toHaveBeenCalled();
  });
});
