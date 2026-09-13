import React, { useMemo, type ComponentProps, type RefObject } from "react";
import type { View } from "react-native";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { mergeRefs } from "@/utils/merge-refs";
import { useSettingsTarget } from "./target";

/** Uses the menu engine's existing item ref and selection lifecycle. */
export function SettingsMenuItem({
  settingIds,
  itemRef,
  onLayout,
  ...props
}: ComponentProps<typeof DropdownMenuItem> & { settingIds: readonly string[] }) {
  const { node, handleLayout } = useSettingsTarget(settingIds, onLayout);
  const mergedRef = useMemo(
    () => mergeRefs(node as RefObject<View | null>, itemRef),
    [node, itemRef],
  );
  return <DropdownMenuItem {...props} itemRef={mergedRef} onLayout={handleLayout} />;
}
