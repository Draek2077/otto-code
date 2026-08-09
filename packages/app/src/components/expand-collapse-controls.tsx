import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { ListChevronsDownUp, ListChevronsUpDown } from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

const ThemedExpandIcon = withUnistyles(ListChevronsUpDown);
const ThemedCollapseIcon = withUnistyles(ListChevronsDownUp);

const mutedColor = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

export function ExpandCollapseControls({
  onExpand,
  onCollapse,
}: {
  onExpand: () => void;
  onCollapse: () => void;
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
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("message.expandCollapse.expandAll")}
        hitSlop={4}
        onPress={handleExpand}
        style={styles.button}
        testID="expand-all-control"
      >
        <ThemedExpandIcon size={14} uniProps={mutedColor} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("message.expandCollapse.collapseAll")}
        hitSlop={4}
        onPress={handleCollapse}
        style={styles.button}
        testID="collapse-all-control"
      >
        <ThemedCollapseIcon size={14} uniProps={mutedColor} />
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
  button: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
}));
