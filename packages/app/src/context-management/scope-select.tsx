import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  SelectField,
  type SelectFieldOption,
  type SelectFieldRenderOptionInput,
} from "@/components/ui/select-field";

/**
 * One of the two "what am I evaluating against" pickers at the head of Context
 * Management, in the shape they share.
 *
 * Both used to be wrapping chip rows — five window presets, then a chip per
 * personality — which spent four rows of the densest panel in the app before a
 * single number appeared, and grew without bound as a host collected
 * personalities. A dropdown is the right control for a list that gets long: it
 * costs one row whatever the roster does, and it has somewhere to put a search
 * field.
 *
 * The label rides inside the trigger rather than above it, so the pair fits on
 * one line and each control reads as a sentence its value finishes —
 * "Evaluate against 200K", "Viewing context for Everyone".
 */
export interface ScopeSelectProps {
  /** The leading half of the sentence, e.g. "Evaluate against". */
  label: string;
  /** Option id of the current selection. */
  value: string;
  /** The trailing half — what the trigger reads after the label. */
  displayLabel: string;
  options: SelectFieldOption<string>[];
  onSelect: (id: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  renderOption?: (input: SelectFieldRenderOptionInput<string>) => ReactElement;
  testID?: string;
}

export function ScopeSelect({
  label,
  value,
  displayLabel,
  options,
  onSelect,
  searchable = false,
  searchPlaceholder,
  renderOption,
  testID,
}: ScopeSelectProps): ReactElement {
  const { t } = useTranslation();
  const selectedDisplay = useMemo(() => ({ label: displayLabel }), [displayLabel]);
  const leading = useMemo(
    () => (
      <Text style={styles.leadingLabel} numberOfLines={1}>
        {label}
      </Text>
    ),
    [label],
  );
  const handleChange = useCallback((next: string) => onSelect(next), [onSelect]);

  return (
    <View style={styles.slot}>
      <SelectField
        field={false}
        size="sm"
        label={label}
        title={label}
        value={value}
        selectedDisplay={selectedDisplay}
        options={options}
        onChange={handleChange}
        placeholder={displayLabel}
        emptyText={t("common.empty.noOptionsMatchSearch")}
        searchable={searchable}
        searchPlaceholder={searchPlaceholder}
        renderOption={renderOption}
        triggerLeading={leading}
        triggerStyle={styles.trigger}
        triggerTestID={testID}
      />
    </View>
  );
}

/** The panel's compact bump: this is its first screen, so +2 below `md`. */
function bump(size: number) {
  return { xs: size + 2, md: size };
}

const styles = StyleSheet.create((theme) => ({
  // Both pickers share the row and wrap onto their own line rather than
  // ellipsizing a personality's name down to nothing on a phone.
  slot: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 170,
    minWidth: 0,
  },
  trigger: {
    minWidth: 0,
  },
  leadingLabel: {
    flexShrink: 0,
    color: theme.colors.mutedForeground,
    fontSize: bump(theme.fontSize.xs),
  },
}));
