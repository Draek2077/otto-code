import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Import as ImportIcon } from "@/components/icons/material-icons";
import { compactUp, type Theme } from "@/styles/theme";

const ThemedImportIcon = withUnistyles(ImportIcon);
const iconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

interface ComposerImportPillProps {
  onPress: () => void;
  disabled?: boolean;
}

export function ComposerImportPill({ onPress, disabled = false }: ComposerImportPillProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const bodyStyle = useMemo(() => [styles.body, isHovered && styles.bodyHovered], [isHovered]);
  return (
    <View style={styles.row}>
      <Pressable
        testID="composer-import-agent-pill"
        accessibilityRole="button"
        accessibilityLabel={t("importSession.title")}
        onPress={onPress}
        disabled={disabled}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        style={bodyStyle}
      >
        <ThemedImportIcon uniProps={iconColorMapping} />
        <Text style={styles.label} numberOfLines={1}>
          {t("importSession.title")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
  },
  body: {
    flexDirection: "row",
    alignItems: "center",
    gap: compactUp(theme.spacing[2]),
    paddingHorizontal: compactUp(theme.spacing[3]),
    paddingVertical: compactUp(theme.spacing[2]),
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
  },
  bodyHovered: {
    backgroundColor: theme.colors.surface2,
  },
  label: {
    color: theme.colors.foreground,
    // Explicit compact bump (not left to the ambient theme-patch scale).
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
  },
}));
