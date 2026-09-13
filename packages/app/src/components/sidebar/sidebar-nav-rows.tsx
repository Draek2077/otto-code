import { router, usePathname } from "expo-router";
import {
  CalendarClock,
  Columns2,
  FileText,
  History,
  Network,
  Plus,
  Search,
} from "@/components/icons/material-icons";
import { memo, useCallback, useMemo, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  groupSidebarNavigationRows,
  sidebarNavPlacement,
  sidebarNavFallbackLabel,
} from "@/sidebar-nav/otto-sidebar-nav";
import { sidebarNavigationLayoutStyles } from "@/components/sidebar/sidebar-navigation-layout";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { PluginSidebarItemRow } from "@/plugins/sidebar-items";
import { canCreateWorktreeForProjectKind } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  type BuiltinSidebarNavId,
} from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import {
  buildNewWorkspaceRoute,
  buildArtifactsRoute,
  buildKanbanRoute,
  buildRunsRoute,
  buildSchedulesRoute,
  buildSessionsRoute,
} from "@/utils/host-routes";

interface SidebarNavRowProps {
  onBeforeNavigate?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
}

interface SidebarNavRowsProps extends SidebarNavRowProps {
  /** Style for the group wrapper, which the sidebar owns. */
  style?: StyleProp<ViewStyle>;
  isSingleColumn?: boolean;
}

/**
 * Top-level sidebar navigation, ordered and filtered by the user's
 * `sidebarNavItems` preference. Renders nothing — not even the bordered group
 * wrapper — when every item is hidden.
 */
export function SidebarNavRows({
  style,
  onBeforeNavigate,
  isSingleColumn = false,
}: SidebarNavRowsProps) {
  const { items } = useSidebarNavItems();
  const rows = useMemo(
    () =>
      groupSidebarNavigationRows(
        items.filter((item) => item.visible && sidebarNavPlacement(item) === "navigation"),
      ),
    [items],
  );
  if (rows.length === 0) return null;
  return (
    <View style={[style, styles.rows]}>
      {rows.map((row) => {
        const first = row[0];
        if (first.kind === "plugin")
          return (
            <PluginSidebarItemRow
              key={first.key}
              group={first.group}
              onBeforeNavigate={onBeforeNavigate}
            />
          );
        return (
          <View key={first.key} style={[styles.row, isSingleColumn && styles.singleColumn]}>
            {row.map((item) => {
              if (item.kind !== "builtin") return null;
              const Row = BUILTIN_ROWS[item.id];
              return (
                <Row
                  key={item.key}
                  onBeforeNavigate={onBeforeNavigate}
                  containerStyle={[
                    sidebarNavigationLayoutStyles.itemTwoColumn,
                    isSingleColumn && sidebarNavigationLayoutStyles.itemSingleColumn,
                    styles.item,
                  ]}
                />
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const SidebarNewWorkspaceRow = memo(function SidebarNewWorkspaceRow({
  onBeforeNavigate,
  containerStyle,
}: SidebarNavRowProps) {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("new-workspace"));
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const activeWorkspaceServerId = activeWorkspaceSelection?.serverId ?? null;
  const activeWorkspaceId = activeWorkspaceSelection?.workspaceId ?? null;
  const activeWorkspace = useWorkspace(activeWorkspaceServerId, activeWorkspaceId);
  const supportsWorkspaceMultiplicity = useHostFeature(
    activeWorkspaceServerId,
    "workspaceMultiplicity",
  );
  const canUseActiveWorkspaceContext = Boolean(
    activeWorkspace &&
    (supportsWorkspaceMultiplicity || canCreateWorktreeForProjectKind(activeWorkspace.projectKind)),
  );

  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(
      activeWorkspaceServerId
        ? buildNewWorkspaceRoute(
            activeWorkspace && canUseActiveWorkspaceContext
              ? {
                  serverId: activeWorkspaceServerId,
                  sourceDirectory: activeWorkspace.projectRootPath,
                  projectId: activeWorkspace.projectId,
                }
              : { serverId: activeWorkspaceServerId },
          )
        : buildNewWorkspaceRoute(),
    );
  }, [activeWorkspace, activeWorkspaceServerId, canUseActiveWorkspaceContext, onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={Plus}
      label={t(builtinSidebarNavLabelKey("new-workspace"))}
      onPress={handlePress}
      testID="sidebar-global-new-workspace"
      variant="compact"
      allowLabelWrap
      containerStyle={containerStyle}
      shortcutKeys={shortcutKeys}
    />
  );
});

function SidebarHistoryRow({ onBeforeNavigate, containerStyle }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSessionsRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={History}
      label={t(builtinSidebarNavLabelKey("history"))}
      onPress={handlePress}
      isActive={pathname.includes("/sessions")}
      testID="sidebar-sessions"
      variant="compact"
      allowLabelWrap
      containerStyle={containerStyle}
    />
  );
}

function SidebarSearchRow({ onBeforeNavigate, containerStyle }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("search"));
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    setCommandCenterOpen(true);
  }, [onBeforeNavigate, setCommandCenterOpen]);

  return (
    <SidebarHeaderRow
      icon={Search}
      label={t(builtinSidebarNavLabelKey("search"))}
      onPress={handlePress}
      testID="sidebar-search"
      variant="compact"
      allowLabelWrap
      containerStyle={containerStyle}
      shortcutKeys={shortcutKeys}
    />
  );
}

function SidebarSchedulesRow({ onBeforeNavigate, containerStyle }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSchedulesRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={CalendarClock}
      label={t(builtinSidebarNavLabelKey("schedules"))}
      onPress={handlePress}
      isActive={pathname.includes("/schedules")}
      testID="sidebar-schedules"
      variant="compact"
      allowLabelWrap
      containerStyle={containerStyle}
    />
  );
}

const OTTO_DESTINATIONS = {
  artifacts: { Icon: FileText, route: buildArtifactsRoute, pathname: "/artifacts" },
  kanban: { Icon: Columns2, route: buildKanbanRoute, pathname: "/kanban" },
  runs: { Icon: Network, route: buildRunsRoute, pathname: "/runs" },
} as const;

function SidebarOttoDestinationRow({
  id,
  onBeforeNavigate,
  containerStyle,
}: SidebarNavRowProps & { id: keyof typeof OTTO_DESTINATIONS }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const destination = OTTO_DESTINATIONS[id];
  const onPress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(destination.route());
  }, [destination, onBeforeNavigate]);
  return (
    <SidebarHeaderRow
      icon={destination.Icon}
      label={t(builtinSidebarNavLabelKey(id), { defaultValue: sidebarNavFallbackLabel(id) })}
      onPress={onPress}
      isActive={pathname.includes(destination.pathname)}
      testID={"sidebar-" + id}
      variant="compact"
      allowLabelWrap
      containerStyle={containerStyle}
    />
  );
}

const BUILTIN_ROWS: Record<BuiltinSidebarNavId, ComponentType<SidebarNavRowProps>> = {
  "new-workspace": SidebarNewWorkspaceRow,
  history: SidebarHistoryRow,
  search: SidebarSearchRow,
  schedules: SidebarSchedulesRow,
  artifacts: (props) => <SidebarOttoDestinationRow {...props} id="artifacts" />,
  kanban: (props) => <SidebarOttoDestinationRow {...props} id="kanban" />,
  runs: (props) => <SidebarOttoDestinationRow {...props} id="runs" />,
};

const styles = StyleSheet.create((theme) => ({
  rows: { gap: theme.spacing[1] },
  row: {
    width: "100%",
    flexDirection: "row",
    paddingHorizontal: theme.spacing[2],
    gap: theme.spacing[1],
  },
  singleColumn: { flexDirection: "column" },
  item: { paddingHorizontal: 0 },
}));
