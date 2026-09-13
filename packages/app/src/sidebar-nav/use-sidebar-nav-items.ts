import { useCallback, useMemo } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import { useInstalledPlugins } from "@/plugins/registry";
import { groupPluginSidebarContributions } from "@/plugins/sidebar-groups";
import { OTTO_SIDEBAR_NAV_BUILTINS, sidebarNavPlacement } from "./otto-sidebar-nav";
import {
  moveSidebarNavItem,
  resolveSidebarNavItems,
  setSidebarNavItemVisible,
  type SidebarNavItem,
} from "./model";

export interface UseSidebarNavItemsReturn {
  /** Every top-level item in display order, hidden ones included. */
  items: SidebarNavItem[];
  setVisible: (key: string, visible: boolean) => void;
  move: (key: string, direction: "up" | "down") => void;
}

export function useSidebarNavItems(): UseSidebarNavItemsReturn {
  const plugins = useInstalledPlugins();
  const { settings, updateSettings } = useAppSettings();
  const preferences = settings.sidebarNavItems;
  const pluginGroups = useMemo(() => groupPluginSidebarContributions(plugins), [plugins]);

  const items = useMemo(
    () =>
      resolveSidebarNavItems({
        pluginGroups,
        preferences,
        builtinItems: OTTO_SIDEBAR_NAV_BUILTINS,
      }),
    [pluginGroups, preferences],
  );

  const setVisible = useCallback(
    (key: string, visible: boolean) => {
      void updateSettings((current) => {
        const previous = current.sidebarNavItems;
        const currentItems = resolveSidebarNavItems({
          pluginGroups,
          preferences: previous,
          builtinItems: OTTO_SIDEBAR_NAV_BUILTINS,
        });
        return {
          sidebarNavItems: setSidebarNavItemVisible({
            items: currentItems,
            key,
            visible,
            previous,
          }),
        };
      });
    },
    [pluginGroups, updateSettings],
  );

  const move = useCallback(
    (key: string, direction: "up" | "down") => {
      void updateSettings((current) => {
        const previous = current.sidebarNavItems;
        const currentItems = resolveSidebarNavItems({
          pluginGroups,
          preferences: previous,
          builtinItems: OTTO_SIDEBAR_NAV_BUILTINS,
        });
        const moving = currentItems.find((item) => item.key === key);
        const placementItems = moving
          ? currentItems.filter((item) => sidebarNavPlacement(item) === sidebarNavPlacement(moving))
          : currentItems;
        return {
          sidebarNavItems: moveSidebarNavItem({
            items: placementItems,
            key,
            direction,
            previous,
          }),
        };
      });
    },
    [pluginGroups, updateSettings],
  );

  return { items, setVisible, move };
}
