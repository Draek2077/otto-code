// The Active Team switcher — the "switch instantly from the main UI" surface
// for Agent Teams (docs/agent-teams.md). Default home: a row
// in the top-left sidebar menu, directly above "New workspace". An appearance
// setting (teamSwitcherPlacement) relocates it into the workspace title bar
// ahead of the other tools, styled like the tool dropdowns.
//
// Selection is daemon truth: picking a team patches `agentTeams.activeTeamId`
// and the control renders from the hot-reloaded config, so every connected
// client agrees instantly. No client-side selection state. Switching is
// deliberately unceremonious — snapshot semantics protect running agents.
//
// i18n: English-only pending a translation pass (build-first, translate-last).
import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { Alert, Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { router } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getActiveAgentTeam } from "@otto-code/protocol/agent-teams";
import { ChevronDown, Layers } from "@/components/icons/material-icons";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSettings } from "@/hooks/use-settings";
import { useHosts, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useAgentTeamsFeature } from "@/screens/settings/agent-teams-section";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import type { Theme } from "@/styles/theme";

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

const sidebarIconMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});
const sidebarIconForegroundMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.sm,
});
const chevronMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

/**
 * Sidebar mount point — renders only while the appearance setting keeps the
 * switcher in its default sidebar home.
 */
export function SidebarActiveTeamSwitchers({
  onBeforeNavigate,
}: {
  onBeforeNavigate?: () => void;
}): ReactElement | null {
  const placement = useSettings((settings) => settings.teamSwitcherPlacement);
  if (placement !== "sidebar") {
    return null;
  }
  return <ActiveTeamSwitchers variant="sidebar" onBeforeNavigate={onBeforeNavigate} />;
}

/**
 * Title-bar mount point — renders only when the appearance setting relocates
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
 * One switcher per connected host that advertises the agentTeams capability —
 * gating happens inside each row (absent feature / empty team list ⇒ null), so
 * a host without teams renders nothing and the whole surface disappears,
 * matching the zero-setup invariant.
 */
export function ActiveTeamSwitchers({
  variant,
  onBeforeNavigate,
}: {
  variant: ActiveTeamSwitcherVariant;
  onBeforeNavigate?: () => void;
}): ReactElement {
  const hosts = useHosts();
  return (
    <>
      {hosts.map((host) => (
        <ActiveTeamSwitcher
          key={host.serverId}
          serverId={host.serverId}
          hostCount={hosts.length}
          hostLabel={host.label}
          variant={variant}
          onBeforeNavigate={onBeforeNavigate}
        />
      ))}
    </>
  );
}

function ActiveTeamSwitcher({
  serverId,
  hostCount,
  hostLabel,
  variant,
  onBeforeNavigate,
}: {
  serverId: string;
  hostCount: number;
  hostLabel: string;
  variant: ActiveTeamSwitcherVariant;
  onBeforeNavigate?: () => void;
}): ReactElement | null {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const hasFeature = useAgentTeamsFeature(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const teams = useMemo(() => config?.agentTeams?.teams ?? [], [config]);
  const activeTeam = useMemo(() => getActiveAgentTeam(config?.agentTeams), [config]);
  const personalities = config?.agentPersonalities?.personalities;

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

  // Renders only when the host advertises the capability AND has ≥ 1 team —
  // no teams configured means no switcher anywhere (zero-setup invariant).
  if (!isConnected || !hasFeature || teams.length === 0) {
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
        />
      </View>
      <Combobox
        options={options}
        value={activeTeam?.id ?? NO_TEAM_OPTION_ID}
        onSelect={handleSelect}
        searchable={teams.length > 8}
        title={hostCount > 1 ? `Active team — ${hostLabel}` : "Active team"}
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
}): ReactElement {
  const sidebarStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.sidebarButton,
      (Boolean(hovered) || open) && styles.sidebarButtonHovered,
    ],
    [open],
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
  const displayLabel = hostLabel ? `${label} · ${hostLabel}` : label;

  const renderSidebarChildren = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => {
      const isHighlighted = Boolean(state.hovered) || open;
      return (
        <>
          {avatarStyle ? (
            <View style={avatarStyle} />
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
    [avatarStyle, displayLabel, isSwitching, open],
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
  sidebarButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  sidebarLabel: {
    flexShrink: 1,
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  sidebarLabelHighlighted: {
    flexShrink: 1,
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
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
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    maxWidth: 220,
  },
  headerTriggerActive: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surfaceHover,
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
}));
