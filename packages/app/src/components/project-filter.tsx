import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown } from "@/components/icons/material-icons";
import { StyleSheet } from "react-native-unistyles";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { shortenPath } from "@/utils/shorten-path";

export const ALL_PROJECTS_OPTION_ID = "__all_projects__";

export interface ProjectFilterOption {
  /** Stable id used as the filter value — the project's repo-root path. */
  id: string;
  /** Human-readable project name. */
  label: string;
}

export interface ProjectFilterProps {
  /** Every known project, whether or not it currently has items to show. */
  options: ProjectFilterOption[];
  /** Selected project id, or undefined for "All projects". */
  value: string | undefined;
  onChange: (projectId: string | undefined) => void;
}

export function ProjectFilter({
  options: projectOptions,
  value,
  onChange,
}: ProjectFilterProps): ReactElement {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const options = useMemo<ComboboxOption[]>(
    () => [
      { id: ALL_PROJECTS_OPTION_ID, label: "All projects" },
      ...projectOptions.map((option) => ({ id: option.id, label: option.label })),
    ],
    [projectOptions],
  );

  const selectedLabel =
    value === undefined
      ? "All projects"
      : (projectOptions.find((option) => option.id === value)?.label ?? shortenPath(value));

  const handleSelect = useCallback(
    (id: string) => {
      onChange(id === ALL_PROJECTS_OPTION_ID ? undefined : id);
      setOpen(false);
    },
    [onChange],
  );

  const handlePress = useCallback(() => setOpen((current) => !current), []);
  const triggerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      (Boolean(hovered) || pressed || open) && styles.triggerActive,
    ],
    [open],
  );

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          onPress={handlePress}
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={`Filter by project (${selectedLabel})`}
          testID="project-filter-trigger"
        >
          <Text style={styles.triggerText} numberOfLines={1}>
            {selectedLabel}
          </Text>
          <ChevronDown size={16} color={styles.chevron.color} />
        </Pressable>
      </View>
      <Combobox
        options={options}
        value={value ?? ALL_PROJECTS_OPTION_ID}
        onSelect={handleSelect}
        searchable={options.length > 6}
        title="Filter by project"
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    // Matches the "New artifact"/"New schedule" button beside it and the status
    // filter below it: the compact 32px control height at every width.
    minHeight: 32,
    maxWidth: 240,
  },
  triggerActive: {
    borderColor: theme.colors.borderAccent,
  },
  triggerText: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  chevron: {
    color: theme.colors.foregroundMuted,
  },
}));
