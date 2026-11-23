import type { ComponentProps } from "react";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { DensityIcon } from "@/components/ui/density-icon";
import { sidebarNavigationChrome } from "./navigation-chrome";

/** One navigation action, with its existing behavior presented as a row or a header icon. */
export function SidebarNavigationRow({
  iconOnly,
  ...props
}: ComponentProps<typeof SidebarHeaderRow> & { iconOnly?: boolean }) {
  if (!iconOnly || !props.icon) return <SidebarHeaderRow {...props} />;
  return (
    <ToolbarButton
      label={props.accessibilityLabel ?? props.label}
      onPress={props.onPress}
      testID={props.testID}
      nativeID={props.nativeID}
      selected={props.isActive}
      shortcut={props.shortcutKeys}
      style={sidebarNavigationChrome.action}
    >
      <DensityIcon
        icon={props.icon}
        size="sm"
        color={props.isActive ? "foreground" : "foregroundMuted"}
      />
    </ToolbarButton>
  );
}
