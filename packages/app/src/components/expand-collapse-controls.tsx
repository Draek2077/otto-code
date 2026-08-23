import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { ListChevronsDownUp, ListChevronsUpDown } from "@/components/icons/material-icons";
import { isNative } from "@/constants/platform";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

const ThemedExpandIcon = withUnistyles(ListChevronsUpDown);
const ThemedCollapseIcon = withUnistyles(ListChevronsDownUp);

const mutedColor = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

export function ExpandCollapseControls({
  onExpand,
  onCollapse,
  visible,
}: {
  onExpand: () => void;
  onCollapse: () => void;
  visible: boolean;
}) {
  const { t } = useTranslation();
  const handleExpand = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      onExpand();
    },
    [onExpand],
  );
  const handleCollapse = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      onCollapse();
    },
    [onCollapse],
  );
  // On web, accessibilityRole="button" makes react-native-web render a real
  // <button>, and these Pressables live inside the ExpandableBadge row's own
  // button — an invalid nested <button> that breaks hydration. Gate the role to
  // native (same pattern as the open-file button in message.tsx and
  // artifact-card.tsx). The role-less Pressable still renders a tabIndex=0 div
  // with usePressEvents key handling, so it stays keyboard focusable and
  // Enter-activatable, and accessibilityLabel maps to aria-label so it keeps
  // its name for assistive tech.
  return (
    <View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.container, !visible && styles.containerHidden]}
    >
      <Pressable
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel={t("message.expandCollapse.expandAll")}
        hitSlop={4}
        onPress={handleExpand}
        style={styles.button}
        testID="expand-all-control"
      >
        <ThemedExpandIcon size="sm" uniProps={mutedColor} />
      </Pressable>
      <Pressable
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel={t("message.expandCollapse.collapseAll")}
        hitSlop={4}
        onPress={handleCollapse}
        style={styles.button}
        testID="collapse-all-control"
      >
        <ThemedCollapseIcon size="sm" uniProps={mutedColor} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: "auto",
  },
  containerHidden: {
    opacity: 0,
  },
  button: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
}));
