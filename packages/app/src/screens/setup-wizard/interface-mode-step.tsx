/**
 * InterfaceModeStep — wizard step 1. Two large cards, User vs Developer. The
 * first real question of setup: the chosen depth reframes every screen after it
 * (and the app it lands in). Presentational — selection is lifted to the shell,
 * which persists `interfaceMode` immediately so the rest of the wizard already
 * renders at the chosen depth.
 *
 * TODO(i18n): strings are inline English (this whole wizard surface is
 * translated in a later pass, matching welcome-step.tsx).
 */

import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { InterfaceMode } from "@/hooks/use-settings";

interface InterfaceModeOption {
  value: InterfaceMode;
  title: string;
  tagline: string;
  bullets: string[];
}

const OPTIONS: InterfaceModeOption[] = [
  {
    value: "user",
    title: "User",
    tagline: "Chat with AI agents, organize projects, get things done.",
    bullets: ["Focused, friendly interface", "No developer tooling to wade through"],
  },
  {
    value: "developer",
    title: "Developer",
    tagline: "The full development environment.",
    bullets: ["Files, diffs, terminals, search", "Git, pull requests, everything Otto can do"],
  },
];

interface InterfaceModeStepProps {
  selected: InterfaceMode | null;
  onSelect: (mode: InterfaceMode) => void;
}

export function InterfaceModeStep({ selected, onSelect }: InterfaceModeStepProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>How do you want to use Otto?</Text>
        <Text style={styles.subtitle}>You can switch anytime in Settings.</Text>
      </View>
      <View style={styles.cards}>
        {OPTIONS.map((option) => (
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
    fontSize: { xs: theme.fontSize["2xl"] + 2, md: theme.fontSize["2xl"] },
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: -0.4,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: theme.fontSize.base + 2, md: theme.fontSize.base },
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
    fontSize: { xs: theme.fontSize.xl + 2, md: theme.fontSize.xl },
    fontWeight: theme.fontWeight.semibold,
  },
  cardTagline: {
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.base + 2, md: theme.fontSize.base },
    lineHeight: { xs: 24, md: 22 },
  },
  bullets: {
    gap: theme.spacing[1],
  },
  bullet: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: theme.fontSize.sm + 2, md: theme.fontSize.sm },
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
