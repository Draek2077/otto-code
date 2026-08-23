// The grouped Active Team switcher - one control standing in for every host's
// team picker once the client is connected to more than one host that has teams.
//
// Why it exists: the per-host switcher (active-team-switcher.tsx) renders one
// row per host. With three hosts that is three controls competing for the same
// strip, which reads as noise in the sidebar and does not fit in the title bar
// at all - and every pixel spent there is a pixel taken from the project list,
// which is what people actually came for. So 2+ hosts collapse into a single
// trigger: a strip of active-team swatches plus a count ("3 Active Teams"), and
// a two-level popover - hosts first, that host's teams behind a drill-down.
//
// Switching a team closes the whole popover. Changing two hosts is a deliberate
// second trip, which keeps the "did that apply?" question from ever coming up.
//
// Selection stays daemon truth exactly as in the single-host control: the patch
// lands on `agentTeams.activeTeamId` for that host and the swatch strip
// re-renders from the hot-reloaded config.
//
// i18n: English-only, matching active-team-switcher.tsx (build-first,
// translate-last); both surfaces get their translation pass together.
import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Alert, Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { router } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getActiveAgentTeam } from "@otto-code/protocol/agent-teams";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import type { ActiveTeamSwitcherVariant } from "@/components/active-team-switcher";
import { ChevronDown, ChevronRight } from "@/components/icons/material-icons";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { deriveAvatarAcronym, readableTextColor } from "@/utils/avatar-badge";
import { compactUp, type Theme } from "@/styles/theme";

/**
 * What the grouped trigger needs to know about one host. Deliberately all
 * primitives: each per-host switcher reports this upward on every config echo,
 * so a value-equal payload must be cheap to compare and impossible to churn on
 * object identity. The team list itself is fetched by the drill-down panel.
 */
export interface HostActiveTeamEntry {
  serverId: string;
  hostLabel: string;
  activeTeamId: string | null;
  activeTeamName: string | null;
  activeTeamColor: string | null;
}

export function isSameHostActiveTeamEntry(a: HostActiveTeamEntry, b: HostActiveTeamEntry): boolean {
  return (
    a.serverId === b.serverId &&
    a.hostLabel === b.hostLabel &&
    a.activeTeamId === b.activeTeamId &&
    a.activeTeamName === b.activeTeamName &&
    a.activeTeamColor === b.activeTeamColor
  );
}

// Beyond this the swatch strip stops reading as a glance-able summary and just
// eats the width it was meant to save; the count text still tells the truth.
const MAX_TRIGGER_SWATCHES = 4;

const NO_TEAM_ROW_ID = "__no-team__";
const EDIT_TEAMS_ROW_ID = "__edit-teams__";

// The Combobox is driven entirely by `children` here (two-level content), so
// its option-list props are inert - same shape the model selector uses.
const EMPTY_COMBOBOX_OPTIONS: ComboboxOption[] = [];
function noop(): void {}

type GroupView = { kind: "hosts" } | { kind: "host"; serverId: string; hostLabel: string };

const HOSTS_VIEW: GroupView = { kind: "hosts" };

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const spinnerMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: "small" as const,
});
const chevronMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

function describeActiveTeams(count: number): string {
  if (count === 0) {
    return "No Active Teams";
  }
  if (count === 1) {
    return "1 Active Team";
  }
  return `${count} Active Teams`;
}

/**
 * A team's colored circle with its acronym, or a muted "?" when the host has no
 * active team. `lg` matches the sidebar's project-icon square so the strip sits
 * at parity with the workspace list; `sm` is the title-bar size.
 */
function TeamSwatch({
  color,
  name,
  size,
}: {
  color: string | null;
  name: string | null;
  size: "sm" | "lg";
}): ReactElement {
  const circleStyle = useMemo(() => {
    const base = size === "lg" ? styles.swatchLg : styles.swatchSm;
    return color ? [base, { backgroundColor: color }] : [base, styles.swatchEmpty];
  }, [color, size]);
  const textStyle = useMemo(() => {
    const base = size === "lg" ? styles.swatchTextLg : styles.swatchTextSm;
    return color ? [base, { color: readableTextColor(color) }] : [base, styles.swatchTextEmpty];
  }, [color, size]);
  const acronym = useMemo(() => (color && name ? deriveAvatarAcronym(name) : "?"), [color, name]);

  return (
    <View style={circleStyle}>
      <Text style={textStyle} numberOfLines={1} allowFontScaling={false}>
        {acronym}
      </Text>
    </View>
  );
}

/** The trigger's summary row: one swatch per host, capped, with a "+N" tail. */
function TeamSwatchStrip({
  entries,
  size,
}: {
  entries: HostActiveTeamEntry[];
  size: "sm" | "lg";
}): ReactElement {
  const shown = entries.slice(0, MAX_TRIGGER_SWATCHES);
  const overflow = entries.length - shown.length;
  return (
    <View style={styles.swatchStrip}>
      {shown.map((entry) => (
        <TeamSwatch
          key={entry.serverId}
          color={entry.activeTeamColor}
          name={entry.activeTeamName}
          size={size}
        />
      ))}
      {overflow > 0 ? <Text style={styles.swatchOverflow}>{`+${overflow}`}</Text> : null}
    </View>
  );
}

export function ActiveTeamGroupSwitcher({
  entries,
  variant,
  onBeforeNavigate,
}: {
  entries: HostActiveTeamEntry[];
  variant: ActiveTeamSwitcherVariant;
  onBeforeNavigate?: () => void;
}): ReactElement {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<GroupView>(HOSTS_VIEW);
  const [isSwitching, setIsSwitching] = useState(false);

  const activeCount = entries.filter((entry) => entry.activeTeamId !== null).length;
  const summary = describeActiveTeams(activeCount);

  // Always reopen at the host list - a drill-down left over from the previous
  // visit would silently apply the next pick to the wrong host.
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      setView(HOSTS_VIEW);
    }
  }, []);
  const handleToggle = useCallback(() => {
    if (!open) {
      setView(HOSTS_VIEW);
    }
    setOpen(!open);
  }, [open]);
  const handleClose = useCallback(() => setOpen(false), []);
  const handleBack = useCallback(() => setView(HOSTS_VIEW), []);
  const handleSelectHost = useCallback((serverId: string, hostLabel: string) => {
    setView({ kind: "host", serverId, hostLabel });
  }, []);
  const handleSwitchStart = useCallback(() => setIsSwitching(true), []);
  const handleSwitchEnd = useCallback(() => setIsSwitching(false), []);

  const header = useMemo<SheetHeader>(
    () =>
      view.kind === "host"
        ? { title: view.hostLabel, back: { onPress: handleBack, accessibilityLabel: "All hosts" } }
        : { title: "Active teams" },
    [view, handleBack],
  );

  return (
    <View style={variant === "sidebar" ? styles.sidebarContainer : styles.headerContainer}>
      <View ref={anchorRef} collapsable={false}>
        <GroupTrigger
          variant={variant}
          entries={entries}
          summary={summary}
          isSwitching={isSwitching}
          open={open}
          accessibilityLabel={`Active teams: ${activeCount} of ${entries.length} hosts`}
          onPress={handleToggle}
        />
      </View>
      <Combobox
        options={EMPTY_COMBOBOX_OPTIONS}
        value=""
        onSelect={noop}
        open={open}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        header={header}
        desktopMinWidth={280}
      >
        {view.kind === "host" ? (
          <HostTeamOptions
            serverId={view.serverId}
            onClose={handleClose}
            onSwitchStart={handleSwitchStart}
            onSwitchEnd={handleSwitchEnd}
            onBeforeNavigate={onBeforeNavigate}
          />
        ) : (
          <HostList entries={entries} onSelectHost={handleSelectHost} />
        )}
      </Combobox>
    </View>
  );
}

function GroupTrigger({
  variant,
  entries,
  summary,
  isSwitching,
  open,
  accessibilityLabel,
  onPress,
}: {
  variant: ActiveTeamSwitcherVariant;
  entries: HostActiveTeamEntry[];
  summary: string;
  isSwitching: boolean;
  open: boolean;
  accessibilityLabel: string;
  onPress: () => void;
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

  const renderSidebarChildren = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => {
      const isHighlighted = Boolean(state.hovered) || open;
      return (
        <>
          <TeamSwatchStrip entries={entries} size="lg" />
          <Text
            style={isHighlighted ? styles.sidebarLabelHighlighted : styles.sidebarLabel}
            numberOfLines={1}
          >
            {summary}
          </Text>
          <TriggerTail isSwitching={isSwitching} />
        </>
      );
    },
    [entries, summary, isSwitching, open],
  );

  if (variant === "sidebar") {
    return (
      <Pressable
        onPress={onPress}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={sidebarStyle}
        testID="active-team-group-switcher"
      >
        {renderSidebarChildren}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={headerStyle}
      testID="active-team-group-switcher"
    >
      <TeamSwatchStrip entries={entries} size="sm" />
      <Text style={styles.headerLabel} numberOfLines={1}>
        {summary}
      </Text>
      <TriggerTail isSwitching={isSwitching} />
    </Pressable>
  );
}

function TriggerTail({ isSwitching }: { isSwitching: boolean }): ReactElement {
  if (isSwitching) {
    return <ThemedLoadingSpinner uniProps={spinnerMapping} />;
  }
  return <ThemedChevronDown uniProps={chevronMapping} />;
}

/** Level 1: one row per host, showing which team is active there. */
function HostList({
  entries,
  onSelectHost,
}: {
  entries: HostActiveTeamEntry[];
  onSelectHost: (serverId: string, hostLabel: string) => void;
}): ReactElement {
  return (
    <View style={styles.list}>
      {entries.map((entry) => (
        <HostRow key={entry.serverId} entry={entry} onSelectHost={onSelectHost} />
      ))}
    </View>
  );
}

function HostRow({
  entry,
  onSelectHost,
}: {
  entry: HostActiveTeamEntry;
  onSelectHost: (serverId: string, hostLabel: string) => void;
}): ReactElement {
  const handlePress = useCallback(
    () => onSelectHost(entry.serverId, entry.hostLabel),
    [onSelectHost, entry.serverId, entry.hostLabel],
  );
  const leadingSlot = useMemo(
    () => <TeamSwatch color={entry.activeTeamColor} name={entry.activeTeamName} size="sm" />,
    [entry.activeTeamColor, entry.activeTeamName],
  );
  const trailingSlot = useMemo(() => <ThemedChevronRight uniProps={chevronMapping} />, []);

  return (
    <ComboboxItem
      label={entry.hostLabel}
      description={entry.activeTeamName ?? "No active team"}
      leadingSlot={leadingSlot}
      trailingSlot={trailingSlot}
      onPress={handlePress}
      testID={`active-team-group-host-${entry.serverId}`}
    />
  );
}

/**
 * Level 2: the picked host's teams. Owns its own daemon-config read and the
 * patch, because the parent has no per-host client - it only holds the summary
 * each switcher reported. The patch is fired and then the popover closes over
 * it; the in-flight spinner lives on the parent's trigger (this panel is gone
 * by then), which is what `onSwitchStart`/`onSwitchEnd` carry.
 */
function HostTeamOptions({
  serverId,
  onClose,
  onSwitchStart,
  onSwitchEnd,
  onBeforeNavigate,
}: {
  serverId: string;
  onClose: () => void;
  onSwitchStart: () => void;
  onSwitchEnd: () => void;
  onBeforeNavigate?: () => void;
}): ReactElement {
  const { config, isLoading, patchConfig } = useDaemonConfig(serverId);
  const teams = useMemo(() => config?.agentTeams?.teams ?? [], [config]);
  const activeTeam = useMemo(() => getActiveAgentTeam(config?.agentTeams), [config]);
  const personalities = config?.agentProfiles;
  const activeTeamId = activeTeam?.id ?? null;

  const handleSelect = useCallback(
    (rowId: string) => {
      onClose();
      if (rowId === EDIT_TEAMS_ROW_ID) {
        onBeforeNavigate?.();
        router.push(buildSettingsHostSectionRoute(serverId, "agents"));
        return;
      }
      const nextActiveTeamId = rowId === NO_TEAM_ROW_ID ? null : rowId;
      if (nextActiveTeamId === activeTeamId) {
        return;
      }
      onSwitchStart();
      void (async () => {
        try {
          await patchConfig({ agentTeams: { activeTeamId: nextActiveTeamId } });
        } catch (error) {
          Alert.alert(
            "Unable to switch team",
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          onSwitchEnd();
        }
      })();
    },
    [serverId, activeTeamId, patchConfig, onClose, onSwitchStart, onSwitchEnd, onBeforeNavigate],
  );

  const memberCounts = useMemo(() => {
    const known = new Set((personalities ?? []).map((entry) => entry.id));
    const counts: Record<string, number> = {};
    for (const team of teams) {
      counts[team.id] = (team.memberIds ?? []).filter((memberId) => known.has(memberId)).length;
    }
    return counts;
  }, [teams, personalities]);

  if (isLoading && teams.length === 0) {
    return (
      <View style={styles.loadingState}>
        <ThemedLoadingSpinner uniProps={spinnerMapping} />
      </View>
    );
  }

  return (
    <View style={styles.list}>
      <TeamRow
        id={NO_TEAM_ROW_ID}
        label="No active team"
        description="Full roster, no team prompt"
        color={null}
        selected={activeTeamId === null}
        onSelect={handleSelect}
      />
      {teams.map((team) => (
        <TeamRow
          key={team.id}
          id={team.id}
          label={team.name}
          description={describeMemberCount(memberCounts[team.id] ?? 0)}
          color={team.avatar?.color ?? null}
          selected={activeTeamId === team.id}
          onSelect={handleSelect}
        />
      ))}
      <TeamRow
        id={EDIT_TEAMS_ROW_ID}
        label="Edit teams…"
        description={null}
        color={null}
        selected={false}
        onSelect={handleSelect}
      />
    </View>
  );
}

function describeMemberCount(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

function TeamRow({
  id,
  label,
  description,
  color,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  description: string | null;
  color: string | null;
  selected: boolean;
  onSelect: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onSelect(id), [onSelect, id]);
  const leadingSlot = useMemo<ReactNode>(
    () => (color ? <TeamSwatch color={color} name={label} size="sm" /> : null),
    [color, label],
  );

  return (
    <ComboboxItem
      label={label}
      description={description ?? undefined}
      leadingSlot={leadingSlot}
      selected={selected}
      onPress={handlePress}
      testID={`active-team-group-team-${id}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  sidebarContainer: {
    // Mirrors the sidebar header group rows' outer padding.
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    userSelect: "none",
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
    backgroundColor: theme.colors.surfaceInteractiveHover,
  },
  sidebarLabel: {
    flexShrink: 1,
    fontSize: {
      xs: theme.fontSize.base + 2,
      md: theme.fontSize.base,
    },
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
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
    maxWidth: 240,
  },
  headerTriggerActive: {
    backgroundColor: theme.colors.surfaceToggleHover,
  },
  headerLabel: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  swatchStrip: {
    flexDirection: "row",
    alignItems: "center",
    // Tighter than spacing[1] on purpose: the swatches must read as one grouped
    // strip, not as separate controls sitting next to each other.
    gap: 2,
  },
  swatchOverflow: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    marginLeft: 2,
  },
  // Tracks the appearance icon-scale setting the same way the single switcher's
  // avatar does, so the strip stays at parity with the project icon squares.
  swatchLg: {
    width: theme.iconSize.lg,
    height: theme.iconSize.lg,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  swatchSm: {
    width: compactUp(16),
    height: compactUp(16),
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  swatchEmpty: {
    backgroundColor: theme.colors.surface2,
  },
  swatchTextLg: {
    fontSize: compactUp(10),
    fontWeight: theme.fontWeight.semibold,
    lineHeight: compactUp(12),
    textAlign: "center",
  },
  swatchTextSm: {
    fontSize: compactUp(9),
    fontWeight: theme.fontWeight.semibold,
    lineHeight: compactUp(11),
    textAlign: "center",
  },
  swatchTextEmpty: {
    color: theme.colors.foregroundMuted,
  },
  list: {
    paddingVertical: theme.spacing[1],
  },
  loadingState: {
    paddingVertical: theme.spacing[6],
    alignItems: "center",
    justifyContent: "center",
  },
}));
