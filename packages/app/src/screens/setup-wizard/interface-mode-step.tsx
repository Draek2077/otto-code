/**
 * InterfaceModeStep - wizard step 1. Two large cards, User vs Developer. The
 * first real question of setup: the chosen depth reframes every screen after it
 * (and the app it lands in). Presentational - selection is lifted to the shell,
 * which persists `interfaceMode` immediately so the rest of the wizard already
 * renders at the chosen depth.
 */

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { InterfaceMode } from "@/hooks/use-settings";

interface InterfaceModeOption {
  value: InterfaceMode;
  title: string;
  tagline: string;
  bullets: string[];
}

interface InterfaceModeStepProps {
  selected: InterfaceMode | null;
  onSelect: (mode: InterfaceMode) => void;
}

export function InterfaceModeStep({ selected, onSelect }: InterfaceModeStepProps) {
  const { t } = useTranslation();

  const options = useMemo<InterfaceModeOption[]>(
    () => [
      {
        value: "user",
        title: t("setupWizard.mode.user.title"),
        tagline: t("setupWizard.mode.user.tagline"),
        bullets: [
          t("setupWizard.mode.user.bulletInterface"),
          t("setupWizard.mode.user.bulletNoTooling"),
        ],
      },
      {
        value: "developer",
        title: t("setupWizard.mode.developer.title"),
        tagline: t("setupWizard.mode.developer.tagline"),
        bullets: [
          t("setupWizard.mode.developer.bulletTools"),
          t("setupWizard.mode.developer.bulletGit"),
        ],
      },
    ],
    [t],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("setupWizard.mode.title")}</Text>
        <Text style={styles.subtitle}>{t("setupWizard.mode.subtitle")}</Text>
      </View>
      <View style={styles.cards}>
        {options.map((option) => (
          <InterfaceModeCard
            key={option.value}
            option={option}
            isSelected={selected === option.value}
            onSelect={onSelect}
          />
        ))}
      </View>
    </View>
  );
}

function InterfaceModeCard({
  option,
  isSelected,
  onSelect,
}: {
  option: InterfaceModeOption;
  isSelected: boolean;
  onSelect: (mode: InterfaceMode) => void;
}) {
  const handlePress = useCallback(() => onSelect(option.value), [onSelect, option.value]);
  const cardStyle = useMemo(() => [styles.card, isSelected && styles.cardSelected], [isSelected]);
  const radioStyle = useMemo(
    () => [styles.radio, isSelected && styles.radioSelected],
    [isSelected],
  );
  const selectionState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={selectionState}
      testID={`setup-interface-mode-${option.value}`}
      onPress={handlePress}
      style={cardStyle}
    >
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>{option.title}</Text>
        <View style={radioStyle}>{isSelected ? <View style={styles.radioDot} /> : null}</View>
      </View>
      <Text style={styles.cardTagline}>{option.tagline}</Text>
      <View style={styles.bullets}>
        {option.bullets.map((bullet) => (
          <Text key={bullet} style={styles.bullet}>
            {`•  ${bullet}`}
          </Text>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    gap: theme.spacing[6],
  },
  header: {
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: -0.4,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  cards: {
    gap: theme.spacing[4],
    flexDirection: { xs: "column", md: "row" },
  },
  card: {
    flex: { xs: undefined, md: 1 },
    gap: theme.spacing[3],
    padding: theme.spacing[6],
    borderRadius: theme.borderRadius.xl,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  cardSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
  },
  cardTagline: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: { xs: 24, md: 22 },
  },
  bullets: {
    gap: theme.spacing[1],
  },
  bullet: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: { xs: 22, md: 20 },
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: theme.borderWidth[2],
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    borderColor: theme.colors.accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.accent,
  },
}));
