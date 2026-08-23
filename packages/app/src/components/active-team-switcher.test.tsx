/**
 * @vitest-environment jsdom
 *
 * The grouping decision is the part that cannot be read off the code: which
 * hosts qualify is only knowable from inside each per-host row (it takes that
 * host's daemon config), so the rows report upward and the parent counts. These
 * cover the threshold (2+ qualifying hosts collapse, 1 does not), the summary
 * the collapsed trigger has to earn its width with, and the "host has teams but
 * none active" case that the swatch strip renders as a placeholder.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme } = vi.hoisted(() => ({
  theme: {
    colorScheme: "dark",
    spacing: { 0: 0, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 },
    iconSize: { xs: 12, sm: 14, md: 18, lg: 20 },
    borderWidth: { 1: 1 },
    borderRadius: { sm: 4, md: 6, lg: 8, xl: 12, "2xl": 16, full: 999 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { normal: "400", medium: "500", semibold: "600" },
    colors: {
      surface0: "#000",
      surface1: "#111",
      surface2: "#222",
      surfaceHover: "#333",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      borderAccent: "#666",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  hosts: [] as Array<{ serverId: string; label: string }>,
  configs: {} as Record<string, unknown>,
  loading: {} as Record<string, boolean>,
  patchConfig: vi.fn(async () => undefined),
  routerPush: vi.fn(),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function" ? (factory as (t: typeof theme) => unknown)(theme) : factory,
  },
  withUnistyles: <T,>(component: T): T => component,
  useUnistyles: () => ({ theme }),
}));

vi.mock("@/components/icons/material-icons", () => {
  const createIcon = (name: string) => () => React.createElement("span", { "data-icon": name });
  return {
    ChevronDown: createIcon("ChevronDown"),
    ChevronRight: createIcon("ChevronRight"),
    Layers: createIcon("Layers"),
  };
});

// The popover stays closed in every case here; what it renders is the
// drill-down's business, and mounting it would drag in floating-ui + the
// bottom sheet for no added coverage.
vi.mock("@/components/ui/combobox", () => ({
  Combobox: () => null,
  ComboboxItem: () => null,
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("span", { "data-icon": "spinner" }),
}));

vi.mock("expo-router", () => ({ router: { push: mocks.routerPush } }));

vi.mock("@/hooks/use-settings", () => ({ useSettings: () => "sidebar" }));

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => mocks.hosts,
  useHostRuntimeIsConnected: () => true,
}));

vi.mock("@/screens/settings/agent-teams-section", () => ({
  useAgentTeamsFeature: () => true,
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: (serverId: string) => ({
    config: mocks.configs[serverId] ?? null,
    isLoading: mocks.loading[serverId] ?? false,
    patchConfig: mocks.patchConfig,
  }),
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { ActiveTeamSwitchers } from "./active-team-switcher";

function buildTeam(id: string, name: string, color: string) {
  return { id, name, memberIds: [], avatar: { color } };
}

function buildConfig(teams: ReturnType<typeof buildTeam>[], activeTeamId: string | null) {
  return {
    agentTeams: { teams, activeTeamId },
    agentProfiles: [],
  };
}

const CREW = buildTeam("team-crew", "Otto Crew", "#4ec4ff");
const LAB = buildTeam("team-lab", "Chat Lab", "#ff8a4e");
const TRIAGE = buildTeam("team-triage", "Ops Triage", "#7cff8a");

describe("ActiveTeamSwitchers", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    mocks.hosts = [];
    mocks.configs = {};
    mocks.loading = {};
    mocks.patchConfig.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  function render() {
    act(() => {
      root?.render(<ActiveTeamSwitchers variant="sidebar" />);
    });
  }

  function groupTrigger(): HTMLElement | null {
    return container?.querySelector('[data-testid="active-team-group-switcher"]') ?? null;
  }

  function hostTrigger(serverId: string): HTMLElement | null {
    return container?.querySelector(`[data-testid="active-team-switcher-${serverId}"]`) ?? null;
  }

  it("keeps the per-host switcher when only one host has teams", () => {
    mocks.hosts = [
      { serverId: "host-a", label: "Alpha" },
      { serverId: "host-b", label: "Bravo" },
    ];
    mocks.configs = {
      "host-a": buildConfig([CREW], CREW.id),
      // Feature present, no teams configured - never a switcher (zero-setup).
      "host-b": buildConfig([], null),
    };

    render();

    expect(groupTrigger()).toBeNull();
    expect(hostTrigger("host-a")).not.toBeNull();
    expect(hostTrigger("host-b")).toBeNull();
  });

  it("collapses into one control once two hosts qualify", () => {
    mocks.hosts = [
      { serverId: "host-a", label: "Alpha" },
      { serverId: "host-b", label: "Bravo" },
    ];
    mocks.configs = {
      "host-a": buildConfig([CREW], CREW.id),
      "host-b": buildConfig([LAB], LAB.id),
    };

    render();

    const trigger = groupTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain("2 Active Teams");
    // One swatch per host, drawn from each team's own acronym.
    expect(trigger?.textContent).toContain("OC");
    expect(trigger?.textContent).toContain("CL");
    expect(hostTrigger("host-a")).toBeNull();
    expect(hostTrigger("host-b")).toBeNull();
  });

  it("counts only hosts with an active team and marks the rest", () => {
    mocks.hosts = [
      { serverId: "host-a", label: "Alpha" },
      { serverId: "host-b", label: "Bravo" },
      { serverId: "host-c", label: "Charlie" },
    ];
    mocks.configs = {
      "host-a": buildConfig([CREW], null),
      "host-b": buildConfig([LAB], LAB.id),
      "host-c": buildConfig([TRIAGE], TRIAGE.id),
    };

    render();

    const trigger = groupTrigger();
    expect(trigger?.textContent).toContain("2 Active Teams");
    expect(trigger?.textContent).toContain("?");
    expect(trigger?.textContent).not.toContain("OC");
  });

  it("says so when no host has an active team", () => {
    mocks.hosts = [
      { serverId: "host-a", label: "Alpha" },
      { serverId: "host-b", label: "Bravo" },
    ];
    mocks.configs = {
      "host-a": buildConfig([CREW], null),
      "host-b": buildConfig([LAB], null),
    };

    render();

    expect(groupTrigger()?.textContent).toContain("No Active Teams");
  });

  it("shows nothing while a second teams host is still loading its config", () => {
    mocks.hosts = [
      { serverId: "host-a", label: "Alpha" },
      { serverId: "host-b", label: "Bravo" },
    ];
    mocks.configs = { "host-a": buildConfig([CREW], CREW.id) };
    mocks.loading = { "host-b": true };

    render();

    // Rendering host A's own row here would collapse it into the grouped
    // control the moment B reports - a visible flip for no information gained.
    expect(hostTrigger("host-a")).toBeNull();
    expect(groupTrigger()).toBeNull();
  });

  it("uses the singular when exactly one host has an active team", () => {
    mocks.hosts = [
      { serverId: "host-a", label: "Alpha" },
      { serverId: "host-b", label: "Bravo" },
    ];
    mocks.configs = {
      "host-a": buildConfig([CREW], CREW.id),
      "host-b": buildConfig([LAB], null),
    };

    render();

    expect(groupTrigger()?.textContent).toContain("1 Active Team");
  });
});
