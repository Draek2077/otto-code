import { useCallback, useMemo, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentPersonality } from "@otto-code/protocol/messages";

/**
 * "Viewing context for: …" — the selector that makes this tab honest now that
 * personalities carry their own memory.
 *
 * Context used to be a property of a workspace and a provider alone. It is not
 * any more: two personalities in the same workspace send different things,
 * because each brings the lessons it has accrued. A single set of numbers with no
 * identity attached would be a number for nobody.
 *
 * "Everyone" is a real, selectable answer, not a null state: it reports the
 * weight every agent here carries regardless of who runs, which is exactly what
 * you want when you are hunting bloat in the project's own files.
 *
 * Rendered as the same wrapping chip row as the window presets directly above
 * it, on purpose — both answer "what am I evaluating against", and giving the
 * second one a dropdown would make two sibling questions look unrelated.
 */

interface ContextPersonalitySelectorProps {
  personalities: readonly AgentPersonality[];
  /** null = "Everyone": the personality-agnostic report. */
  selectedId: string | null;
  /** Lesson counts by personality id, for the accrual dot. */
  memoryCounts: Record<string, number>;
  onSelect: (personalityId: string | null) => void;
}

export function ContextPersonalitySelector({
  personalities,
  selectedId,
  memoryCounts,
  onSelect,
}: ContextPersonalitySelectorProps): ReactElement | null {
  // A host with no personalities has nothing to choose between, and an empty
  // selector would just be a label over a single dead chip.
  if (personalities.length === 0) {
    return null;
  }
  return (
    <View style={styles.section} testID="context-personality-selector">
      <Text style={styles.sectionLabel}>Viewing context for</Text>
      <View style={styles.chipRow}>
        <PersonalityChip
          label="Everyone"
          personalityId={null}
          selected={selectedId === null}
          lessonCount={0}
          onSelect={onSelect}
        />
        {personalities.map((personality) => (
          <PersonalityChip
            key={personality.id}
            label={personality.name}
            personalityId={personality.id}
            selected={selectedId === personality.id}
            lessonCount={memoryCounts[personality.id] ?? 0}
            onSelect={onSelect}
          />
        ))}
      </View>
    </View>
  );
}

interface PersonalityChipProps {
  label: string;
  personalityId: string | null;
  selected: boolean;
  lessonCount: number;
  onSelect: (personalityId: string | null) => void;
}

function PersonalityChip({
  label,
  personalityId,
  selected,
  lessonCount,
  onSelect,
}: PersonalityChipProps): ReactElement {
  const handlePress = useCallback(() => onSelect(personalityId), [onSelect, personalityId]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={lessonCount > 0 ? `${label}, ${lessonCount} remembered lessons` : label}
      testID={`context-personality-${personalityId ?? "everyone"}`}
      onPress={handlePress}
      style={selected ? styles.chipSelected : styles.chip}
    >
      <Text style={selected ? styles.chipTextSelected : styles.chipText} numberOfLines={1}>
        {label}
      </Text>
      {/* A count, not a dot: "12 lessons" is what makes the weight below
          believable, and it is also what makes deleting this personality feel
          like a decision. */}
      {lessonCount > 0 ? <Text style={styles.chipCount}>{lessonCount}</Text> : null}
    </Pressable>
  );
}

// Matches the summary's own +2 compact bump so the two chip rows read as one
// control group rather than two sizes of the same thing.
function bump(size: number) {
  return { xs: size + 2, md: size };
}

const styles = StyleSheet.create((theme) => {
  const chipBase = {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderWidth: theme.borderWidth[1],
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    maxWidth: 180,
  } as const;
  return {
    section: {
      gap: theme.spacing[1],
      marginTop: theme.spacing[2],
    },
    sectionLabel: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.xs),
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing[1],
    },
    chip: { ...chipBase, borderColor: theme.colors.border },
    chipSelected: { ...chipBase, borderColor: theme.colors.accent },
    chipText: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.xs),
      flexShrink: 1,
    },
    chipTextSelected: {
      color: theme.colors.foreground,
      fontSize: bump(theme.fontSize.xs),
      fontWeight: "600",
      flexShrink: 1,
    },
    chipCount: {
      color: theme.colors.accent,
      fontSize: bump(theme.fontSize.xs),
      fontVariant: ["tabular-nums"],
      flexShrink: 0,
    },
  };
});
