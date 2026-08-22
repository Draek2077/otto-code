// The Active Team switcher - the "switch instantly from the main UI" surface
// for Agent Teams (docs/agent-teams.md). Default home: a row
// in the top-left sidebar menu, directly above "New workspace". An appearance
// setting (teamSwitcherPlacement) relocates it into the workspace title bar
// ahead of the other tools, styled like the tool dropdowns.
//
// Selection is daemon truth: picking a team patches `agentTeams.activeTeamId`
// and the control renders from the hot-reloaded config, so every connected
// client agrees instantly. No client-side selection state. Switching is
// deliberately unceremonious - snapshot semantics protect running agents.
//
// Multi-host: one switcher per host stops scaling at two - see
// active-team-group-switcher.tsx, which takes over the whole surface once two
// or more hosts qualify. Each switcher here reports its summary upward so the
// parent can decide, and renders nothing while the grouped control is up.
//
// i18n: English-only pending a translation pass (build-first, translate-last).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Alert, Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { router } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getActiveAgentTeam } from "@otto-code/protocol/agent-teams";
import type { AgentTeam } from "@otto-code/protocol/messages";
import {
  ActiveTeamGroupSwitcher,
  isSameHostActiveTeamEntry,
  type HostActiveTeamEntry,
} from "@/components/active-team-group-switcher";
import { ChevronDown, Layers } from "@/components/icons/material-icons";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSettings } from "@/hooks/use-settings";
import { useHosts, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useAgentTeamsFeature } from "@/screens/settings/agent-teams-section";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { deriveAvatarAcronym, readableTextColor } from "@/utils/avatar-badge";
import { compactUp, type Theme } from "@/styles/theme";

const NO_TEAM_OPTION_ID = "__no-team__";
const EDIT_TEAMS_OPTION_ID = "__edit-teams__";

export type ActiveTeamSwitcherVariant = "sidebar" | "header";

const ThemedLayers = withUnistyles(Layers);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const spinnerMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: "small" as const,
});

// Sized to iconSize.lg so the "No active team" fallback glyph fills the same
// box as the active-team circle (styles.sidebarAvatarDot) and doesn't read as an
// undersized icon floating next to the larger circle.
const sidebarIconMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.lg,
});
const sidebarIconForegroundMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.lg,
});
const chevronMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

/**
 * Sidebar mount point - renders only while the appearance setting keeps the
 * switcher in its default sidebar home.
 */
export function SidebarActiveTeamSwitchers({
  onBeforeNavigate,
  contentAlignment = "center",
}: {
  onBeforeNavigate?: () => void;
  contentAlignment?: "start" | "center";
}): ReactElement | null {
  const placement = useSettings((settings) => settings.teamSwitcherPlacement);
  if (placement !== "sidebar") {
    return null;
  }
  return (
    <ActiveTeamSwitchers
      variant="sidebar"
      onBeforeNavigate={onBeforeNavigate}
      isSidebarContentCentered={contentAlignment === "center"}
    />
  );
}

/**
 * Title-bar mount point - renders only when the appearance setting relocates
 * the switcher into the workspace header, ahead of the other tools.
 */
export function HeaderActiveTeamSwitchers(): ReactElement | null {
  const placement = useSettings((settings) => settings.teamSwitcherPlacement);
  if (placement !== "titlebar") {
    return null;
  }
  return <ActiveTeamSwitchers variant="header" />;
}

/**
 * One switcher per connected host that advertises the agentTeams capability -
 * gating happens inside each row (absent feature / empty team list ⇒ null), so
 * a host without teams renders nothing and the whole surface disappears,
 * matching the zero-setup invariant.
 *
 * Which hosts qualify is only knowable from inside each row (it takes that
 * host's daemon config), and hooks cannot be called in a loop - so the rows
 * report their summary upward and this component counts. Two or more qualifying
 * hosts collapse into the single grouped control and every row renders null.
 */
export function ActiveTeamSwitchers({
  variant,
  onBeforeNavigate,
  isSidebarContentCentered = true,
}: {
  variant: ActiveTeamSwitcherVariant;
  onBeforeNavigate?: () => void;
  isSidebarContentCentered?: boolean;
}): ReactElement {
  const hosts = useHosts();
  const [reports, setReports] = useState<HostTeamReports>(EMPTY_REPORTS);

  const reportEntry = useCallback((serverId: string, report: HostTeamReport | null) => {
    setReports((current) => applyHostTeamReport(current, serverId, report));
  }, []);

  // Host order drives swatch order; a host that dropped off the list keeps no
  // entry even if its row has not unmounted yet.
  const groupedEntries = useMemo(
    () =>
      hosts
        .map((host) => reports[host.serverId])
        .filter((report): report is HostActiveTeamEntry => isReadyReport(report)),
    [hosts, reports],
  );
  const pendingCount = useMemo(
    () => hosts.filter((host) => reports[host.serverId] === PENDING_REPORT).length,
    [hosts, reports],
  );
  const isGrouped = groupedEntries.length > 1;
  // Hold the per-host rows back while hosts are still reporting in: showing one
  // row now and collapsing it into the grouped control a beat later is a visible
  // layout flip, and the title bar is exactly where that reads worst.
  const isSettling = pendingCount > 0 && groupedEntries.length + pendingCount > 1;

  return (
    <>
      {isGrouped ? (
        <ActiveTeamGroupSwitcher
          entries={groupedEntries}
          variant={variant}
          onBeforeNavigate={onBeforeNavigate}
          isSidebarContentCentered={isSidebarContentCentered}
        />
      ) : null}
      {hosts.map((host) => (
        <ActiveTeamSwitcher
          key={host.serverId}
          serverId={host.serverId}
          hostCount={hosts.length}
          hostLabel={host.label}
          variant={variant}
          grouped={isGrouped || isSettling}
          onReport={reportEntry}
          onBeforeNavigate={onBeforeNavigate}
          isSidebarContentCentered={isSidebarContentCentered}
        />
      ))}
    </>
  );
}

/** A host that qualifies, or one whose daemon config has not arrived yet. */
export type HostTeamReport = HostActiveTeamEntry | typeof PENDING_REPORT;
type HostTeamReports = Record<string, HostTeamReport>;

export const PENDING_REPORT = "pending";
const EMPTY_REPORTS: HostTeamReports = {};

function isReadyReport(report: HostTeamReport | undefined): report is HostActiveTeamEntry {
  return report !== undefined && report !== PENDING_REPORT;
}

/**
 * Folds one host's report into the map. Exported for its own test: it is the
 * piece that has to be indifferent to daemon-config echoes, which arrive
 * constantly and mostly say nothing new.
 */
export function applyHostTeamReport(
  current: HostTeamReports,
  serverId: string,
  report: HostTeamReport | null,
): HostTeamReports {
  const existing = current[serverId];
  if (report === null) {
    if (existing === undefined) {
      return current;
    }
    const next = { ...current };
    delete next[serverId];
    return next;
  }
  if (report === PENDING_REPORT) {
    return existing === PENDING_REPORT ? current : { ...current, [serverId]: report };
  }
  // Value equality, not identity: every config echo re-runs the report, and a
  // fresh object each time would re-render the whole surface for nothing.
  if (isReadyReport(existing) && isSameHostActiveTeamEntry(existing, report)) {
    return current;
  }
  return { ...current, [serverId]: report };
}

/**
 * Publishes what the grouped control needs from this host - primitives only, so
 * the parent can compare by value and ignore config echoes that changed nothing.
 */
function useHostActiveTeamReport({
  serverId,
  hostLabel,
  isEligible,
  isPending,
  activeTeam,
  onReport,
}: {
  serverId: string;
  hostLabel: string;
  isEligible: boolean;
  isPending: boolean;
  activeTeam: AgentTeam | null;
  onReport: (serverId: string, report: HostTeamReport | null) => void;
}): void {
  const activeTeamId = activeTeam?.id ?? null;
  const activeTeamName = activeTeam?.name ?? null;
  const activeTeamColor = activeTeam?.avatar?.color ?? null;
  useEffect(() => {
    if (isEligible) {
      onReport(serverId, { serverId, hostLabel, activeTeamId, activeTeamName, activeTeamColor });
      return;
    }
    onReport(serverId, isPending ? PENDING_REPORT : null);
  }, [
    onReport,
    serverId,
    hostLabel,
    isEligible,
    isPending,
    activeTeamId,
    activeTeamName,
    activeTeamColor,
  ]);
  // Retract on unmount only. A cleanup on the effect above would drop the entry
  // on every config echo, momentarily taking the qualifying count below two and
  // flickering the grouped control back into per-host rows.
  useEffect(() => () => onReport(serverId, null), [onReport, serverId]);
}

function ActiveTeamSwitcher({
  serverId,
  hostCount,
  hostLabel,
  variant,
  grouped,
  onReport,
  onBeforeNavigate,
  isSidebarContentCentered,
}: {
  serverId: string;
  hostCount: number;
  hostLabel: string;
  variant: ActiveTeamSwitcherVariant;
  grouped: boolean;
  onReport: (serverId: string, report: HostTeamReport | null) => void;
  onBeforeNavigate?: () => void;
  isSidebarContentCentered: boolean;
}): ReactElement | null {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const hasFeature = useAgentTeamsFeature(serverId);
  const { config, isLoading, patchConfig } = useDaemonConfig(serverId);
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const teams = useMemo(() => config?.agentTeams?.teams ?? [], [config]);
  const activeTeam = useMemo(() => getActiveAgentTeam(config?.agentTeams), [config]);
  const personalities = config?.agentPersonalities?.personalities;

  const isEligible = isConnected && hasFeature && teams.length > 0;
  // "Might still qualify" - a teams-capable host whose config is in flight.
  const isPending = isConnected && hasFeature && isLoading;
  useHostActiveTeamReport({ serverId, hostLabel, isEligible, isPending, activeTeam, onReport });

  const options = useMemo<ComboboxOption[]>(() => {
    const known = new Set((personalities ?? []).map((entry) => entry.id));
    return [
      {
        id: NO_TEAM_OPTION_ID,
        label: "No active team",
        description: "Full roster, no team prompt",
      },
      ...teams.map((team) => {
        const memberCount = (team.memberIds ?? []).filter((memberId) => known.has(memberId)).length;
        return {
          id: team.id,
          label: team.name,
          description: memberCount === 1 ? "1 member" : `${memberCount} members`,
        };
      }),
      { id: EDIT_TEAMS_OPTION_ID, label: "Edit teams…" },
    ];
  }, [teams, personalities]);

  const handleSelect = useCallback(
    (id: string) => {
      setOpen(false);
      if (id === EDIT_TEAMS_OPTION_ID) {
        onBeforeNavigate?.();
        router.push(buildSettingsHostSectionRoute(serverId, "agents"));
        return;
      }
      const nextActiveTeamId = id === NO_TEAM_OPTION_ID ? null : id;
      if (nextActiveTeamId === (activeTeam?.id ?? null)) {
        return;
      }
      setIsSwitching(true);
      void (async () => {
        try {
          // The control re-renders from the hot-reloaded config echo; the
          // spinner only covers the round-trip.
          await patchConfig({ agentTeams: { activeTeamId: nextActiveTeamId } });
        } catch (error) {
          Alert.alert(
            "Unable to switch team",
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          setIsSwitching(false);
        }
      })();
    },
    [serverId, activeTeam, patchConfig, onBeforeNavigate],
  );

  const handleToggle = useCallback(() => setOpen((current) => !current), []);

  // Renders only when the host advertises the capability AND has ≥ 1 team -
  // no teams configured means no switcher anywhere (zero-setup invariant) - and
  // only while the grouped control is not standing in for every host.
  if (!isEligible || grouped) {
    return null;
  }

  const label = activeTeam?.name ?? "No active team";
  const accessibilityLabel =
    hostCount > 1 ? `Active team on ${hostLabel}: ${label}` : `Active team: ${label}`;

  return (
    <View style={variant === "sidebar" ? styles.sidebarContainer : styles.headerContainer}>
      <View ref={anchorRef} collapsable={false}>
        <SwitcherTrigger
          variant={variant}
          label={label}
          hostLabel={hostCount > 1 ? hostLabel : null}
          avatarColor={activeTeam?.avatar?.color ?? null}
          isSwitching={isSwitching}
          open={open}
          accessibilityLabel={accessibilityLabel}
          onPress={handleToggle}
          testID={`active-team-switcher-${serverId}`}
          isSidebarContentCentered={isSidebarContentCentered}
        />
      </View>
      <Combobox
        options={options}
        value={activeTeam?.id ?? NO_TEAM_OPTION_ID}
        onSelect={handleSelect}
        searchable={teams.length > 8}
        title={hostCount > 1 ? `Active team - ${hostLabel}` : "Active team"}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopMinWidth={240}
      />
    </View>
  );
}

function SwitcherTrigger({
  variant,
  label,
  hostLabel,
  avatarColor,
  isSwitching,
  open,
  accessibilityLabel,
  onPress,
  testID,
  isSidebarContentCentered,
}: {
  variant: ActiveTeamSwitcherVariant;
  label: string;
  hostLabel: string | null;
  avatarColor: string | null;
  isSwitching: boolean;
  open: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  testID: string;
  isSidebarContentCentered: boolean;
}): ReactElement {
  const sidebarStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.sidebarButton,
      isSidebarContentCentered && styles.sidebarButtonContentCentered,
      (Boolean(hovered) || open) && styles.sidebarButtonHovered,
    ],
    [isSidebarContentCentered, open],
  );
  const headerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.headerTrigger,
      (Boolean(hovered) || pressed || open) && styles.headerTriggerActive,
    ],
    [open],
  );
  const avatarStyle = useMemo(
    () => (avatarColor ? [styles.avatarDot, { backgroundColor: avatarColor }] : null),
    [avatarColor],
  );
  // Sidebar variant uses a larger circle, sized to the workspace list's project
  // icon squares (theme.iconSize.lg), so the top-left control reads at parity.
  const sidebarAvatarStyle = useMemo(
    () => (avatarColor ? [styles.sidebarAvatarDot, { backgroundColor: avatarColor }] : null),
    [avatarColor],
  );
  // Acronym drawn inside the circle (from the team name, not the host suffix),
  // in a black/white color picked to contrast against the circle's fill.
  const avatarAcronym = useMemo(() => deriveAvatarAcronym(label), [label]);
  const avatarTextStyle = useMemo(
    () =>
      avatarColor
        ? [styles.sidebarAvatarText, { color: readableTextColor(avatarColor) }]
        : styles.sidebarAvatarText,
    [avatarColor],
  );
  const displayLabel = hostLabel ? `${label} · ${hostLabel}` : label;

  const renderSidebarChildren = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => {
      const isHighlighted = Boolean(state.hovered) || open;
      return (
        <>
          {sidebarAvatarStyle ? (
            <View style={sidebarAvatarStyle}>
              {avatarAcronym ? (
                <Text style={avatarTextStyle} numberOfLines={1} allowFontScaling={false}>
                  {avatarAcronym}
                </Text>
              ) : null}
            </View>
          ) : (
            <ThemedLayers
              uniProps={isHighlighted ? sidebarIconForegroundMapping : sidebarIconMutedMapping}
            />
          )}
          <Text
            style={isHighlighted ? styles.sidebarLabelHighlighted : styles.sidebarLabel}
            numberOfLines={1}
          >
            {displayLabel}
          </Text>
          {isSwitching ? (
            <ThemedLoadingSpinner uniProps={spinnerMapping} />
          ) : (
            <ThemedChevronDown uniProps={chevronMapping} />
          )}
        </>
      );
    },
    [sidebarAvatarStyle, avatarAcronym, avatarTextStyle, displayLabel, isSwitching, open],
  );

  if (variant === "sidebar") {
    return (
      <View style={styles.sidebarButtonContainer}>
        <Pressable
          onPress={onPress}
          accessible
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={sidebarStyle}
          testID={testID}
        >
          {renderSidebarChildren}
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={headerStyle}
      testID={testID}
    >
      {avatarStyle ? <View style={avatarStyle} /> : <ThemedLayers uniProps={chevronMapping} />}
      <Text style={styles.headerLabel} numberOfLines={1}>
        {displayLabel}
      </Text>
      {isSwitching ? (
        <ThemedLoadingSpinner uniProps={spinnerMapping} />
      ) : (
        <ThemedChevronDown uniProps={chevronMapping} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  sidebarContainer: {
    // Mirrors the sidebar header group rows' outer padding.
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    userSelect: "none",
  },
  sidebarButtonContainer: {
    justifyContent: "center",
  },
  sidebarButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  sidebarButtonContentCentered: {
    justifyContent: "center",
  },
  sidebarButtonHovered: {
    backgroundColor: theme.colors.surfaceInteractiveHover,
  },
  sidebarLabel: {
    flexShrink: 1,
    // Match the workspace list's project header font size (sidebar-workspace-list
    // `projectTitle`) so the top-left team control reads at the same scale.
    fontSize: {
      xs: theme.fontSize.base + 2,
      md: theme.fontSize.base,
    },
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  sidebarLabelHighlighted: {
    flexShrink: 1,
    fontSize: {
      xs: theme.fontSize.base + 2,
      md: theme.fontSize.base,
    },
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  headerContainer: {
    justifyContent: "center",
  },
  // Same visual language + height as the header tool dropdown triggers.
  headerTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    // Match the Scripts trigger's 21px content, 4px vertical padding, and
    // 1px outline so adjacent titlebar controls share one height.
    minHeight: theme.fontSize.sm * 1.5 + theme.spacing[1] * 2 + theme.borderWidth[1] * 2,
    maxWidth: 220,
  },
  headerTriggerActive: {
    backgroundColor: theme.colors.surfaceToggleHover,
  },
  headerLabel: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  avatarDot: {
    width: 12,
    height: 12,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  // Exactly the workspace list's project icon square box (theme.iconSize.lg) so
  // the circle reads at the same size as the project squares - and tracks the
  // appearance icon-scale setting the same way, unlike a fixed literal. The
  // smaller fixed-size acronym leaves the breathing room around the letters.
  sidebarAvatarDot: {
    width: theme.iconSize.lg,
    height: theme.iconSize.lg,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  sidebarAvatarText: {
    // Explicit compact bump (like the project icon fallback text) since the
    // iconSize.lg circle doubles on compact but fontSize tokens don't.
    fontSize: compactUp(10),
    fontWeight: theme.fontWeight.semibold,
    lineHeight: compactUp(12),
    textAlign: "center",
  },
}));
