import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { GestureResponderEvent } from "react-native";
import { Pressable, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useMutation } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  Globe,
  Play,
  RotateCw,
  Search,
  Square,
  SquareTerminal,
} from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useDropdownMenuClose,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceScriptGroups } from "@/screens/workspace/use-workspace-script-groups";
import {
  buildScriptMenuView,
  RECENT_SCRIPT_GROUP_KEY,
  type ScriptMenuGroupView,
} from "@/screens/workspace/script-menu-view";
import {
  buildScriptMenuWorkspaceKey,
  useScriptMenuPreferencesStore,
} from "@/screens/workspace/script-menu-preferences-store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/contexts/toast-context";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useIconSize } from "@/styles/theme";
import { openServiceUrl } from "@/utils/open-service-url";
import {
  resolveWorkspaceScriptLink,
  type WorkspaceScriptLinkKind,
  type WorkspaceScriptLinkTarget,
} from "@/utils/workspace-script-links";
import type { Theme } from "@/styles/theme";
import { useWorkspaceServiceRoutePreferencesStore } from "@/workspace-service-routes/store";

type RowActionIcon = "copy" | "open" | "restart" | "start" | "stop" | "terminal";

interface WorkspaceScriptsButtonProps {
  serverId: string;
  workspaceId: string;
  scripts: WorkspaceDescriptor["scripts"];
  liveTerminalIds?: readonly string[];
  /**
   * Required: a script is a terminal that runs a command on launch, so every
   * start must surface the terminal. Call sites open a focused terminal tab
   * (via `markScriptTerminalPending` so the tab survives tab reconciliation).
   */
  onScriptTerminalStarted: (terminalId: string) => void;
  onViewTerminal: (terminalId: string) => void;
  onOpenUrlInBrowserTab?: (url: string) => void;
  hideLabels?: boolean;
  // Stretch to fill the available width (content stays centered).
  fill?: boolean;
  presentation?: "split" | "ghost";
  // Ghost-presentation trigger icon size. The mobile header passes the same
  // `useIconSize(1.5).lg` the Explorer toggle uses so the two buttons match.
  ghostIconSize?: number;
  /** Controlled open state, so a collapsed trigger elsewhere can open the menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Render only a zero-size anchor instead of the button. Used when the compact
   * header fit drops the Play button into the "..." menu: the menu item there
   * flips the controlled `open` on, and the scripts dropdown anchors here.
   */
  hideTrigger?: boolean;
}

interface ScriptRowActionButtonProps {
  accessibilityLabel: string;
  disabled?: boolean;
  icon: RowActionIcon;
  onPress: () => void;
  testID: string;
  tooltipLabel: string;
}

const ThemedPlay = withUnistyles(Play);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedGlobe = withUnistyles(Globe);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedEye = withUnistyles(Eye);
const ThemedCopy = withUnistyles(Copy);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedSquare = withUnistyles(Square);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedSearch = withUnistyles(Search);
// TextInput is a leaf, which is the only thing withUnistyles may wrap
// (docs/unistyles.md). It carries the theme only for placeholderTextColor,
// which has no style-sheet equivalent.
const ThemedTextInput = withUnistyles(TextInput);

const GHOST_TRIGGER_ICON_SIZE = 16;

// Stable identities so the store selectors do not resubscribe every render.
const EMPTY_RECENCY: Record<string, number> = {};
const EMPTY_EXPANSION: Record<string, boolean> = {};

/**
 * Caps the menu before it runs off the screen. Discovered groups are collapsed
 * by default so this is rarely reached, but a user who expands 98 npm scripts
 * needs the list to scroll rather than overflow the viewport.
 */
const SCRIPT_MENU_MAX_HEIGHT = 420;

const filterPlaceholderMapping = (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const blueColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.blue[500],
});
const greenColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.green[500],
});
const redColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.red[500],
});

function RowActionIconElement({
  hovered,
  icon,
}: {
  hovered?: boolean;
  icon: RowActionIcon;
}): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const colorMapping = hovered ? foregroundColorMapping : mutedColorMapping;
  // Row action icons double on mobile, like the script icon's compact scaling.
  const smallIconSize = isCompact ? 22 : 11;
  const largeIconSize = isCompact ? 24 : 12;
  switch (icon) {
    case "copy":
      return <ThemedCopy size={smallIconSize} uniProps={colorMapping} />;
    case "open":
      return <ThemedEye size={largeIconSize} uniProps={colorMapping} />;
    case "restart":
      return <ThemedRotateCw size={smallIconSize} uniProps={colorMapping} />;
    case "start":
      return <ThemedPlay size={smallIconSize} uniProps={colorMapping} />;
    case "stop":
      return <ThemedSquare size={smallIconSize} uniProps={colorMapping} />;
    case "terminal":
      return <ThemedSquareTerminal size={largeIconSize} uniProps={colorMapping} />;
  }
}

function ScriptRowActionButton({
  accessibilityLabel,
  disabled,
  icon,
  onPress,
  testID,
  tooltipLabel,
}: ScriptRowActionButtonProps): ReactElement {
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );

  const renderChildren = useCallback(
    ({ hovered }: { hovered?: boolean }) => <RowActionIconElement hovered={hovered} icon={icon} />,
    [icon],
  );

  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          testID={testID}
          hitSlop={6}
          disabled={disabled}
          onPress={handlePress}
          style={styles.iconActionButton}
        >
          {renderChildren}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent testID={`${testID}-tooltip`} side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{tooltipLabel}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function routeLabelKey(
  kind: WorkspaceScriptLinkKind,
):
  | "workspace.scripts.routes.public"
  | "workspace.scripts.routes.otto"
  | "workspace.scripts.routes.direct" {
  switch (kind) {
    case "public":
      return "workspace.scripts.routes.public";
    case "otto":
      return "workspace.scripts.routes.otto";
    case "direct":
      return "workspace.scripts.routes.direct";
  }
}

function ServiceRouteOption({
  scriptName,
  selectedKind,
  target,
  onSelect,
}: {
  scriptName: string;
  selectedKind: WorkspaceScriptLinkKind;
  target: WorkspaceScriptLinkTarget;
  onSelect: (kind: WorkspaceScriptLinkKind) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(target.kind), [onSelect, target.kind]);
  return (
    <DropdownMenuItem
      testID={`workspace-scripts-route-${scriptName}-${target.kind}`}
      selected={target.kind === selectedKind}
      showSelectedCheck
      description={target.label}
      onSelect={handleSelect}
    >
      {t(routeLabelKey(target.kind))}
    </DropdownMenuItem>
  );
}

function ServiceRouteTriggerContent({
  hovered,
  label,
}: {
  hovered: boolean;
  label: string;
}): ReactElement {
  const isCompact = useIsCompactFormFactor();
  return (
    <>
      <View style={styles.routeSelectorButton}>
        <ThemedChevronDown
          size={isCompact ? 20 : 14}
          uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
        />
      </View>
      <Text style={hovered ? hostLabelActiveStyle : styles.hostLabel} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
}

function ServiceRouteSelector({
  scriptName,
  selectedTarget,
  targets,
  onSelect,
}: {
  scriptName: string;
  selectedTarget: WorkspaceScriptLinkTarget;
  targets: WorkspaceScriptLinkTarget[];
  onSelect: (kind: WorkspaceScriptLinkKind) => void;
}): ReactElement {
  const { t } = useTranslation();
  const accessibilityLabel = t("workspace.scripts.accessibility.chooseUrl", { scriptName });

  return (
    <DropdownMenu>
      <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <View collapsable={false} style={styles.routeSelectorFrame}>
            <DropdownMenuTrigger
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              testID={`workspace-scripts-route-${scriptName}`}
              hitSlop={6}
              style={styles.routeSelectorTrigger}
            >
              {({ hovered }) => (
                <ServiceRouteTriggerContent hovered={hovered} label={selectedTarget.label} />
              )}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        <TooltipContent
          testID={`workspace-scripts-route-${scriptName}-tooltip`}
          side="top"
          align="center"
          offset={8}
        >
          <Text style={styles.tooltipText}>{t("workspace.scripts.actions.chooseUrl")}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="bottom" align="end" minWidth={220} maxWidth={280}>
        {targets.map((target) => (
          <ServiceRouteOption
            key={target.kind}
            scriptName={scriptName}
            selectedKind={selectedTarget.kind}
            target={target}
            onSelect={onSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ServiceLinkRowProps {
  selectedTarget: WorkspaceScriptLinkTarget;
  targets: WorkspaceScriptLinkTarget[];
  scriptName: string;
  onSelectKind: (kind: WorkspaceScriptLinkKind) => void;
  onCopy: (url: string, label: string) => void;
}

function ServiceLinkRow({
  selectedTarget,
  targets,
  scriptName,
  onSelectKind,
  onCopy,
}: ServiceLinkRowProps): ReactElement {
  const { t } = useTranslation();
  const closeMenu = useDropdownMenuClose();
  const { label, url } = selectedTarget;

  const handleCopy = useCallback(() => {
    closeMenu();
    onCopy(url, label);
  }, [url, label, onCopy, closeMenu]);

  return (
    <View style={styles.hostRow}>
      {targets.length > 1 ? (
        <ServiceRouteSelector
          scriptName={scriptName}
          selectedTarget={selectedTarget}
          targets={targets}
          onSelect={onSelectKind}
        />
      ) : (
        <View style={styles.routeDisplay}>
          <View style={styles.routeSelectorButton} />
          <Text style={styles.hostLabel} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
      <ScriptRowActionButton
        accessibilityLabel={t("workspace.scripts.accessibility.copyUrl", { scriptName })}
        testID={`workspace-scripts-copy-${scriptName}`}
        icon="copy"
        onPress={handleCopy}
        tooltipLabel={t("workspace.scripts.actions.copyUrl")}
      />
    </View>
  );
}

function ExitCodeBadge({ code }: { code: number }): ReactElement {
  const { t } = useTranslation();
  const exitTextStyle = code === 0 ? styles.exitBadgeText : exitBadgeTextErrorStyle;
  return (
    <View style={styles.exitBadge}>
      <Text style={exitTextStyle}>{t("workspace.scripts.states.exitCode", { code })}</Text>
    </View>
  );
}

interface ScriptRowProps {
  script: WorkspaceDescriptor["scripts"][number];
  liveTerminalIdSet: Set<string>;
  activeConnection: ReturnType<typeof useHostRuntimeSnapshot> extends infer R
    ? R extends { activeConnection: infer A }
      ? A
      : null
    : null;
  isStartPending: boolean;
  isStopPending: boolean;
  onStartScript: (scriptName: string) => void;
  onStopScript: (scriptName: string) => void;
  onRestartScript: (scriptName: string) => void;
  onCopyUrl: (url: string, label: string) => void;
  preferredRouteKind: WorkspaceScriptLinkKind | null;
  onSelectRouteKind: (kind: WorkspaceScriptLinkKind) => void;
  onViewTerminal?: (terminalId: string) => void;
  onOpenUrlInBrowserTab?: (url: string) => void;
}

function resolveScriptIconColorMapping(args: {
  script: WorkspaceDescriptor["scripts"][number];
  isService: boolean;
  isRunning: boolean;
}): (theme: Theme) => { color: string } {
  const { script, isService, isRunning } = args;
  if (isService) {
    if (isRunning && script.health === "healthy") return greenColorMapping;
    if (isRunning && script.health === "unhealthy") return redColorMapping;
    if (isRunning) return blueColorMapping;
    return mutedColorMapping;
  }
  if (isRunning) return blueColorMapping;
  return mutedColorMapping;
}

function ScriptRow({
  script,
  liveTerminalIdSet,
  activeConnection,
  isStartPending,
  isStopPending,
  onStartScript,
  onStopScript,
  onRestartScript,
  onCopyUrl,
  preferredRouteKind,
  onSelectRouteKind,
  onViewTerminal,
  onOpenUrlInBrowserTab,
}: ScriptRowProps): ReactElement {
  const { t } = useTranslation();
  // Script icon doubles on mobile (14 -> 28) via useIconSize's compact scaling.
  const scriptIconSize = useIconSize().sm;
  const isRunning = script.lifecycle === "running";
  const isService = (script.type ?? "service") === "service";
  const exitCode = script.exitCode ?? null;
  const serviceLink = resolveWorkspaceScriptLink({ script, activeConnection });
  const selectedLink =
    isService && isRunning
      ? (serviceLink.targets.find((target) => target.kind === preferredRouteKind) ??
        serviceLink.primary)
      : null;
  const liveTerminalId =
    script.terminalId && liveTerminalIdSet.has(script.terminalId) ? script.terminalId : null;

  const iconColorMapping = resolveScriptIconColorMapping({ script, isService, isRunning });
  const ScriptIcon = isService ? ThemedGlobe : ThemedSquareTerminal;
  const showExitBadge = !isRunning && exitCode !== null;
  const closeMenu = useDropdownMenuClose();

  const handleOpenService = useCallback(() => {
    if (!selectedLink) return;
    closeMenu();
    void openServiceUrl(selectedLink.url, { openInApp: onOpenUrlInBrowserTab });
  }, [selectedLink, closeMenu, onOpenUrlInBrowserTab]);

  const handleView = useCallback(() => {
    if (liveTerminalId) onViewTerminal?.(liveTerminalId);
  }, [liveTerminalId, onViewTerminal]);

  const handleRun = useCallback(() => {
    onStartScript(script.scriptName);
  }, [onStartScript, script.scriptName]);

  const handleStop = useCallback(() => {
    onStopScript(script.scriptName);
  }, [onStopScript, script.scriptName]);

  const handleRestart = useCallback(() => {
    onRestartScript(script.scriptName);
  }, [onRestartScript, script.scriptName]);

  const scriptNameStyle = useMemo(
    () => (isRunning ? scriptNameActiveStyle : styles.scriptName),
    [isRunning],
  );

  const openServiceAction = selectedLink ? (
    <ScriptRowActionButton
      accessibilityLabel={t("workspace.scripts.accessibility.openService", {
        scriptName: script.scriptName,
      })}
      testID={`workspace-scripts-open-${script.scriptName}`}
      icon="open"
      onPress={handleOpenService}
      tooltipLabel={t("workspace.scripts.actions.openService")}
    />
  ) : null;

  const viewAction =
    isRunning && liveTerminalId ? (
      <ScriptRowActionButton
        accessibilityLabel={t("workspace.scripts.accessibility.viewTerminal", {
          scriptName: script.scriptName,
        })}
        testID={`workspace-scripts-view-${script.scriptName}`}
        icon="terminal"
        onPress={handleView}
        tooltipLabel={t("workspace.scripts.actions.view")}
      />
    ) : null;

  const restartAction = isRunning ? (
    <ScriptRowActionButton
      accessibilityLabel={t("workspace.scripts.accessibility.restartScript", {
        scriptName: script.scriptName,
      })}
      testID={`workspace-scripts-restart-${script.scriptName}`}
      disabled={isStopPending}
      icon="restart"
      onPress={handleRestart}
      tooltipLabel={t("workspace.scripts.actions.restart")}
    />
  ) : null;

  const lifecycleAction = isRunning ? (
    <ScriptRowActionButton
      accessibilityLabel={t("workspace.scripts.accessibility.stopScript", {
        scriptName: script.scriptName,
      })}
      testID={`workspace-scripts-stop-${script.scriptName}`}
      disabled={isStopPending}
      icon="stop"
      onPress={handleStop}
      tooltipLabel={t("workspace.scripts.actions.stop")}
    />
  ) : (
    <ScriptRowActionButton
      accessibilityLabel={t("workspace.scripts.accessibility.runScript", {
        scriptName: script.scriptName,
      })}
      testID={`workspace-scripts-start-${script.scriptName}`}
      disabled={isStartPending}
      icon="start"
      onPress={handleRun}
      tooltipLabel={t("workspace.scripts.actions.run")}
    />
  );

  return (
    <View
      testID={`workspace-scripts-item-${script.scriptName}`}
      accessibilityLabel={t("workspace.scripts.accessibility.script", {
        scriptName: script.scriptName,
      })}
      style={styles.scriptItem}
    >
      <View style={styles.scriptHeader}>
        <ScriptIcon size={scriptIconSize} uniProps={iconColorMapping} style={styles.scriptIcon} />
        <Text style={scriptNameStyle} numberOfLines={1}>
          {script.label ?? script.scriptName}
        </Text>
        {showExitBadge ? <ExitCodeBadge code={exitCode} /> : null}
        <View style={styles.spacer} />
        {openServiceAction}
        {viewAction}
        {restartAction}
        {lifecycleAction}
      </View>
      {/* A discovered row shows what it will actually run — the label is the
          project's own name for it, which on its own says nothing about the
          command behind it. Otto's declared rows keep their existing chrome. */}
      {script.source && script.command ? (
        <View style={styles.hostList}>
          <Text style={styles.commandLabel} numberOfLines={1}>
            {script.command}
          </Text>
        </View>
      ) : null}
      {selectedLink ? (
        <View style={styles.hostList}>
          <ServiceLinkRow
            selectedTarget={selectedLink}
            targets={serviceLink.targets}
            scriptName={script.scriptName}
            onSelectKind={onSelectRouteKind}
            onCopy={onCopyUrl}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * A source's header, doubling as its expand/collapse control.
 *
 * The count is on the header rather than hidden inside the group because the
 * whole point of collapsing is that the user decides whether 98 rows are worth
 * opening; a header that will not say how many is asking them to guess.
 */
function ScriptGroupHeader({
  group,
  onToggle,
}: {
  group: ScriptMenuGroupView;
  onToggle: (groupKey: string, expanded: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const label =
    group.label ??
    (group.key === RECENT_SCRIPT_GROUP_KEY
      ? t("workspace.scripts.sources.recent")
      : t("workspace.scripts.sources.otto"));

  const isExpanded = group.isExpanded;
  const groupKey = group.key;
  const handlePress = useCallback(
    () => onToggle(groupKey, !isExpanded),
    [onToggle, groupKey, isExpanded],
  );
  const accessibilityState = useMemo(() => ({ expanded: isExpanded }), [isExpanded]);

  if (group.isAlwaysExpanded) {
    return (
      <DropdownMenuLabel testID={`workspace-scripts-group-${group.key}`}>{label}</DropdownMenuLabel>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={
        isExpanded
          ? t("workspace.scripts.accessibility.collapseGroup", { groupName: label })
          : t("workspace.scripts.accessibility.expandGroup", { groupName: label })
      }
      testID={`workspace-scripts-group-${group.key}`}
      onPress={handlePress}
      style={styles.groupHeader}
    >
      {({ hovered }) => (
        <>
          {/* Two icons rather than a rotated one: a transform here would need a
              worklet to animate, and a static rotate is the same pixels for
              more machinery. */}
          {group.isExpanded ? (
            <ThemedChevronDown
              size={isCompact ? 18 : 12}
              uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
            />
          ) : (
            <ThemedChevronRight
              size={isCompact ? 18 : 12}
              uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
            />
          )}
          <Text style={hovered ? groupHeaderTextActiveStyle : styles.groupHeaderText}>{label}</Text>
          <View style={styles.spacer} />
          <Text style={styles.groupHeaderCount}>{group.totalCount}</Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * Inline filter, shown only once the menu is too long to scan.
 *
 * `autoFocus` is desktop-only: on a compact form factor focusing it raises the
 * software keyboard over the very list the user came to read.
 */
function ScriptFilterField({
  query,
  onChangeQuery,
}: {
  query: string;
  onChangeQuery: (next: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const placeholder = t("workspace.scripts.filter.placeholder");

  return (
    <View style={styles.filterRow}>
      <ThemedSearch size={isCompact ? 18 : 13} uniProps={mutedColorMapping} />
      <ThemedTextInput
        accessibilityLabel={placeholder}
        testID="workspace-scripts-filter"
        value={query}
        onChangeText={onChangeQuery}
        placeholder={placeholder}
        autoFocus={!isCompact}
        autoCorrect={false}
        autoCapitalize="none"
        style={styles.filterInput}
        uniProps={filterPlaceholderMapping}
      />
    </View>
  );
}

export function WorkspaceScriptsButton({
  serverId,
  workspaceId,
  scripts,
  liveTerminalIds = [],
  onScriptTerminalStarted,
  onViewTerminal,
  onOpenUrlInBrowserTab,
  hideLabels,
  fill,
  presentation = "split",
  ghostIconSize,
  open,
  onOpenChange,
  hideTrigger = false,
}: WorkspaceScriptsButtonProps): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const activeConnection = useHostRuntimeSnapshot(serverId)?.activeConnection ?? null;
  // Uncontrolled callers still need the open state, because discovery refetches
  // on open so an edited package.json is never a stale menu.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const groups = useWorkspaceScriptGroups({
    serverId,
    workspaceId,
    scripts,
    isMenuOpen: isOpen,
  });
  const allScripts = useMemo(() => groups.flatMap((group) => group.scripts), [groups]);

  const [query, setQuery] = useState("");
  // A search is a one-off act, not a setting: reopening the menu should show
  // the curated view again rather than yesterday's half-typed filter.
  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  const workspaceKey = buildScriptMenuWorkspaceKey(serverId, workspaceId);
  const lastRunAtByScriptName = useScriptMenuPreferencesStore(
    (state) => state.lastRunAtByWorkspace[workspaceKey] ?? EMPTY_RECENCY,
  );
  const expansionByGroupKey = useScriptMenuPreferencesStore(
    (state) => state.groupExpansionByWorkspace[workspaceKey] ?? EMPTY_EXPANSION,
  );
  const setGroupExpanded = useScriptMenuPreferencesStore((state) => state.setGroupExpanded);
  const recordScriptRun = useScriptMenuPreferencesStore((state) => state.recordScriptRun);

  const menuView = useMemo(
    () => buildScriptMenuView({ groups, query, expansionByGroupKey, lastRunAtByScriptName }),
    [groups, query, expansionByGroupKey, lastRunAtByScriptName],
  );

  const handleToggleGroup = useCallback(
    (groupKey: string, expanded: boolean) => setGroupExpanded({ workspaceKey, groupKey, expanded }),
    [setGroupExpanded, workspaceKey],
  );
  const preferredRouteKind = useWorkspaceServiceRoutePreferencesStore(
    (state) => state.byServerId[serverId] ?? null,
  );
  const setPreferredRoute = useWorkspaceServiceRoutePreferencesStore(
    (state) => state.setPreferredRoute,
  );
  const liveTerminalIdSet = useMemo(() => new Set(liveTerminalIds), [liveTerminalIds]);
  const pendingRestartRef = useRef<Set<string>>(new Set());

  const startScriptMutation = useMutation({
    mutationFn: async (scriptName: string) => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const result = await client.startWorkspaceScript(workspaceId, scriptName);
      if (result.error) {
        throw new Error(result.error);
      }
      return result;
    },
    onError: (error, scriptName) => {
      toast.show(
        error instanceof Error
          ? error.message
          : t("workspace.scripts.states.startFailed", { scriptName }),
        {
          variant: "error",
        },
      );
    },
    onSuccess: (result) => {
      if (result.terminalId) {
        onScriptTerminalStarted(result.terminalId);
      }
    },
  });
  const startScript = startScriptMutation.mutate;

  const stopScriptMutation = useMutation({
    mutationFn: async (scriptName: string) => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const terminalId = allScripts.find((s) => s.scriptName === scriptName)?.terminalId;
      if (!terminalId) {
        throw new Error(t("workspace.scripts.states.stopFailed", { scriptName }));
      }
      const result = await client.killTerminal(terminalId);
      if (!result.success) {
        throw new Error(t("workspace.scripts.states.stopFailed", { scriptName }));
      }
    },
    onError: (error, scriptName) => {
      pendingRestartRef.current.delete(scriptName);
      toast.show(
        error instanceof Error
          ? error.message
          : t("workspace.scripts.states.stopFailed", { scriptName }),
        {
          variant: "error",
        },
      );
    },
  });

  // Restart = kill the script terminal, then start again once the daemon
  // reports the script as stopped (it tears the runtime entry down on exit).
  useEffect(() => {
    const pending = pendingRestartRef.current;
    if (pending.size === 0) return;
    for (const script of allScripts) {
      if (!pending.has(script.scriptName) || script.lifecycle === "running") continue;
      pending.delete(script.scriptName);
      startScript(script.scriptName);
    }
  }, [allScripts, startScript]);

  const isFillSplit = Boolean(fill) && presentation === "split";
  const rowStyle = useMemo(() => [styles.row, isFillSplit && styles.fillItem], [isFillSplit]);
  const frameStyle = useMemo(
    () => [
      presentation === "ghost" ? styles.ghostButtonFrame : styles.splitButton,
      isFillSplit && styles.fillItem,
    ],
    [isFillSplit, presentation],
  );

  const triggerStyle = useCallback(
    ({
      hovered,
      pressed,
      open: triggerOpen,
    }: {
      hovered: boolean;
      pressed: boolean;
      open: boolean;
    }) => [
      presentation === "ghost" ? styles.ghostButton : styles.splitButtonPrimary,
      isFillSplit && styles.fillItem,
      (hovered || pressed || triggerOpen) &&
        (presentation === "ghost" ? styles.ghostButtonHovered : styles.splitButtonPrimaryHovered),
    ],
    [isFillSplit, presentation],
  );

  const handleStartScript = useCallback(
    (scriptName: string) => {
      // Recorded on intent rather than on success: what the recency order is
      // for is "the thing I reach for", and a script that failed to start is
      // still the thing the user was reaching for.
      recordScriptRun({ workspaceKey, scriptName, runAt: Date.now() });
      startScriptMutation.mutate(scriptName);
    },
    [recordScriptRun, startScriptMutation, workspaceKey],
  );

  const handleStopScript = useCallback(
    (scriptName: string) => stopScriptMutation.mutate(scriptName),
    [stopScriptMutation],
  );

  const handleRestartScript = useCallback(
    (scriptName: string) => {
      pendingRestartRef.current.add(scriptName);
      stopScriptMutation.mutate(scriptName);
    },
    [stopScriptMutation],
  );

  const handleCopyUrl = useCallback(
    (url: string, label: string) => {
      void Clipboard.setStringAsync(url);
      toast.copied(label);
    },
    [toast],
  );

  const handleSelectRouteKind = useCallback(
    (kind: WorkspaceScriptLinkKind) => setPreferredRoute(serverId, kind),
    [serverId, setPreferredRoute],
  );

  if (allScripts.length === 0) {
    return null;
  }

  const hasAnyRunning = allScripts.some((s) => s.lifecycle === "running");
  const triggerPlayMapping = hasAnyRunning ? blueColorMapping : mutedColorMapping;
  const triggerIconSize =
    presentation === "ghost" ? (ghostIconSize ?? GHOST_TRIGGER_ICON_SIZE) : 14;

  const trigger = hideTrigger ? (
    <DropdownMenuTrigger
      testID="workspace-scripts-button"
      disabled
      accessibilityElementsHidden
      style={styles.hiddenTrigger}
    >
      <View />
    </DropdownMenuTrigger>
  ) : (
    <DropdownMenuTrigger
      testID="workspace-scripts-button"
      style={triggerStyle}
      accessibilityRole="button"
      accessibilityLabel={t("workspace.scripts.accessibility.trigger")}
    >
      <View style={styles.splitButtonContent}>
        <ThemedPlay size={triggerIconSize} uniProps={triggerPlayMapping} />
        {!hideLabels && (
          <Text style={styles.splitButtonText} numberOfLines={1}>
            {t("workspace.scripts.title")}
          </Text>
        )}
        {presentation === "split" ? (
          <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
        ) : null}
      </View>
    </DropdownMenuTrigger>
  );

  // One group per source, headed by where its Scripts came from. A single
  // unheaded group is the pre-discovery shape, so a project with only otto.json
  // scripts looks exactly as it always did.
  const showGroupHeaders = menuView.showGroupHeaders;

  const menu = (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      {trigger}
      <DropdownMenuContent
        align="end"
        minWidth={240}
        maxWidth={320}
        maxHeight={SCRIPT_MENU_MAX_HEIGHT}
        scrollable
        testID="workspace-scripts-menu"
      >
        {menuView.showFilter ? <ScriptFilterField query={query} onChangeQuery={setQuery} /> : null}
        <View style={styles.scriptList}>
          {menuView.hasNoMatches ? (
            <Text style={styles.emptyText}>{t("workspace.scripts.filter.noMatches")}</Text>
          ) : null}
          {menuView.groups.map((group, groupIndex) => (
            <Fragment key={group.key}>
              {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
              {showGroupHeaders ? (
                <ScriptGroupHeader group={group} onToggle={handleToggleGroup} />
              ) : null}
              {group.isExpanded
                ? group.scripts.map((script, scriptIndex) => (
                    <Fragment key={script.scriptName}>
                      {scriptIndex > 0 ? <DropdownMenuSeparator /> : null}
                      <ScriptRow
                        script={script}
                        liveTerminalIdSet={liveTerminalIdSet}
                        activeConnection={activeConnection}
                        isStartPending={startScriptMutation.isPending}
                        isStopPending={stopScriptMutation.isPending}
                        onStartScript={handleStartScript}
                        onStopScript={handleStopScript}
                        onRestartScript={handleRestartScript}
                        onCopyUrl={handleCopyUrl}
                        preferredRouteKind={preferredRouteKind}
                        onSelectRouteKind={handleSelectRouteKind}
                        onViewTerminal={onViewTerminal}
                        onOpenUrlInBrowserTab={onOpenUrlInBrowserTab}
                      />
                    </Fragment>
                  ))
                : null}
            </Fragment>
          ))}
        </View>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // The hidden anchor must not enter the row's flex flow (see `hiddenTrigger`),
  // so it skips the row/frame chrome entirely.
  if (hideTrigger) {
    return menu;
  }

  return (
    <View style={rowStyle}>
      <View style={frameStyle}>{menu}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  fillItem: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    // Cap the stretched sidebar-tools variant so a wide sidebar doesn't
    // produce oversized buttons; the row centers the capped buttons instead.
    maxWidth: 150,
  },
  splitButton: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
  },
  ghostButtonFrame: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  // Mirrors the header toggle/menu chrome (`headerIconSlotStyle.slot`) instead of
  // a separately-sized fixed box, so the mobile Play trigger matches the Explorer
  // button beside it exactly.
  ghostButton: {
    padding: {
      xs: theme.spacing[3],
      md: theme.spacing[2],
    },
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  // Matches `headerIconSlotStyle.slotHovered` — this trigger sits in the same
  // header row as the toggles it borrows its chrome from.
  ghostButtonHovered: {
    backgroundColor: theme.colors.surfaceToggleHover,
  },
  splitButtonPrimary: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    justifyContent: "center",
  },
  splitButtonPrimaryHovered: {
    backgroundColor: theme.colors.surfaceToggleHover,
  },
  // Zero-size anchor for the collapsed mode — exists only so the dropdown has a
  // position to open from; must never take layout space or catch pointers.
  // `position: absolute` keeps it out of flex flow: a zero-size *flex item*
  // still consumes a `gap` slot on both sides (same as ArtifactOpenMenu's).
  hiddenTrigger: {
    position: "absolute",
    width: 0,
    height: 0,
    opacity: 0,
    overflow: "hidden",
  },
  splitButtonText: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 1,
  },
  splitButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1.5],
    minHeight: theme.fontSize.sm * 1.5,
  },
  scriptList: {
    paddingVertical: theme.spacing[1],
  },
  // A group header names a group, so it takes `medium` per docs/design.md,
  // while the rows inside stay `normal`.
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: {
      xs: theme.spacing[2],
      md: theme.spacing[1],
    },
    minHeight: {
      xs: 36,
      md: 24,
    },
  },
  groupHeaderText: {
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
    minWidth: 0,
  },
  groupHeaderTextActive: {
    color: theme.colors.foreground,
  },
  groupHeaderCount: {
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: {
      xs: theme.spacing[2],
      md: theme.spacing[1.5],
    },
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.borderAccent,
  },
  filterInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    color: theme.colors.foreground,
    // The row already draws the chrome; the field itself is just the caret.
    outlineWidth: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
  },
  emptyText: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    color: theme.colors.foregroundMuted,
  },
  scriptItem: {
    paddingVertical: 6,
  },
  scriptHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    minHeight: 24,
  },
  scriptIcon: {
    flexShrink: 0,
  },
  scriptName: {
    // Compact bump: +2px on mobile for the scripts dropdown.
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    fontWeight: theme.fontWeight.normal,
    lineHeight: {
      xs: 22,
      md: 18,
    },
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
  },
  scriptNameActive: {
    color: theme.colors.foreground,
  },
  spacer: {
    flex: 1,
    minWidth: 0,
  },
  hostList: {
    marginTop: 2,
    paddingHorizontal: theme.spacing[3],
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: 2,
    minHeight: 18,
  },
  routeDisplay: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  hostLabel: {
    flexShrink: 1,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    lineHeight: {
      xs: 18,
      md: 14,
    },
    color: theme.colors.foregroundMuted,
  },
  hostLabelActive: {
    color: theme.colors.foreground,
  },
  // A command is code, so it takes the code font size like every other code
  // surface (docs/design.md).
  commandLabel: {
    fontSize: {
      xs: theme.fontSize.code + 2,
      md: theme.fontSize.code,
    },
    lineHeight: {
      xs: 18,
      md: 14,
    },
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
  exitBadge: {
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 1,
    borderRadius: 2,
    backgroundColor: theme.colors.surface2,
  },
  exitBadgeText: {
    fontSize: {
      xs: 12,
      md: 10,
    },
    lineHeight: {
      xs: 14,
      md: 12,
    },
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  exitBadgeTextError: {
    color: theme.colors.palette.red[300],
  },
  iconActionButton: {
    padding: 2,
  },
  routeSelectorButton: {
    width: {
      xs: 20,
      md: 14,
    },
    height: {
      xs: 20,
      md: 14,
    },
    alignItems: "center",
    justifyContent: "center",
  },
  routeSelectorFrame: {
    flex: 1,
    minWidth: 0,
  },
  routeSelectorTrigger: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));

const hostLabelActiveStyle = [styles.hostLabel, styles.hostLabelActive];
const groupHeaderTextActiveStyle = [styles.groupHeaderText, styles.groupHeaderTextActive];
const scriptNameActiveStyle = [styles.scriptName, styles.scriptNameActive];
const exitBadgeTextErrorStyle = [styles.exitBadgeText, styles.exitBadgeTextError];
