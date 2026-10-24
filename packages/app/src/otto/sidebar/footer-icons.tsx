/** Otto-owned placement: Brain joins the existing bottom icon line, not the footer's row panel. */
import { useRef } from "react";
import type { View } from "react-native";
import { PluginSidebarItem } from "@/plugins/sidebar-items";
import type { SidebarNavItem } from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";

export function isOttoFooterIcon(item: SidebarNavItem<"footer">): boolean {
  return (
    item.kind === "plugin" &&
    item.group.pluginId === "otto-brain" &&
    item.group.contributionId === "brain"
  );
}

export function OttoSidebarFooterIcons({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { items } = useSidebarNavItems("footer");
  const anchorRef = useRef<View | null>(null);
  return items.map((item) =>
    item.visible && item.kind === "plugin" && isOttoFooterIcon(item) ? (
      <PluginSidebarItem
        key={item.key}
        group={item.group}
        section="footer"
        fallbackAnchorRef={anchorRef}
        onBeforeNavigate={onBeforeNavigate}
      />
    ) : null,
  );
}
