import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useFetchQuery } from "@/data/query";
import { ProjectPickerBrowseButton } from "@/components/project-picker-browse-button";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useRecommendedProjectPaths } from "@/stores/session-store-hooks";
import { buildProjectPickerOptions } from "@/components/project-picker-options";
import { shortenPath } from "@/utils/shorten-path";
import { NewProjectSuggestionRow, NewProjectTextInput } from "./new-project-inputs";

// The page's primary input: the daemon-backed folder search the retired picker
// modal used, rendered inline under the field instead of in a floating list.

// Long enough that fast typing doesn't fire a filesystem scan per keystroke.
const SUGGESTION_DEBOUNCE_MS = 250;
const SUGGESTION_LIMIT = 20;

interface DirectoryFieldProps {
  serverId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  testID?: string;
}

export function DirectoryField({
  serverId,
  value,
  onChange,
  placeholder,
  disabled,
  testID,
}: DirectoryFieldProps) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const recommendedPaths = useRecommendedProjectPaths(serverId);

  const [debouncedQuery, setDebouncedQuery] = useState(value);
  // Suggestions stay hidden until the field is touched, so a seeded value
  // doesn't open a list the user never asked for.
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(value), SUGGESTION_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [value]);

  const suggestionsQuery = useFetchQuery({
    dataShape: "list",
    staleTimeMs: 15_000,
    queryKey: ["new-project-directory-suggestions", serverId, debouncedQuery],
    queryFn: async () => {
      if (!client) {
        return [] as string[];
      }
      const result = await client.getDirectorySuggestions({
        query: debouncedQuery,
        includeDirectories: true,
        includeFiles: false,
        limit: SUGGESTION_LIMIT,
      });
      return (
        result.entries?.flatMap((entry) => (entry.kind === "directory" ? [entry.path] : [])) ?? []
      );
    },
    enabled: Boolean(client) && isConnected && isEditing && !disabled,
    retry: false,
  });

  const options = useMemo(
    () =>
      buildProjectPickerOptions({
        recommendedPaths,
        // Results answer `debouncedQuery`; filtering against the live `value`
        // keeps a slow response from repainting under newer typing.
        serverPaths: debouncedQuery === value ? (suggestionsQuery.data ?? []) : [],
        query: value,
      }),
    [debouncedQuery, recommendedPaths, suggestionsQuery.data, value],
  );

  const handleChangeText = useCallback(
    (text: string) => {
      setIsEditing(true);
      onChange(text);
    },
    [onChange],
  );

  const handleSelect = useCallback(
    (path: string) => {
      onChange(path);
      setIsEditing(false);
    },
    [onChange],
  );

  const handleBrowseError = useCallback(() => setIsEditing(false), []);

  const browseButton = useMemo(
    () => (
      <ProjectPickerBrowseButton
        serverId={serverId}
        disabled={disabled === true}
        onSelect={handleSelect}
        onError={handleBrowseError}
      />
    ),
    [disabled, handleBrowseError, handleSelect, serverId],
  );

  const showSuggestions = isEditing && !disabled && options.length > 0;

  return (
    <View style={styles.container}>
      <NewProjectTextInput
        value={value}
        onChangeText={handleChangeText}
        placeholder={placeholder}
        editable={!disabled}
        prominent
        autoFocus
        trailing={browseButton}
        testID={testID ? `${testID}-input` : undefined}
      />
      {showSuggestions ? (
        <ScrollView
          style={styles.suggestions}
          contentContainerStyle={styles.suggestionsContent}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
          testID={testID ? `${testID}-suggestions` : undefined}
        >
          {options.map((option) => (
            <NewProjectSuggestionRow
              key={option.path}
              path={option.path}
              label={shortenPath(option.path)}
              onSelect={handleSelect}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
  },
  suggestions: {
    maxHeight: 200,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  suggestionsContent: {
    paddingVertical: theme.spacing[1],
  },
}));
