// The settings search overview renders the canonical catalog, result rows,
// and their stylesheet. Extracted from
// settings-screen.tsx, which renders the overview from its desktop
// content at one registration point.
import { useCallback, useMemo, useState } from "react";
import { ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Search } from "@/components/icons/material-icons";
import { SearchClearButton } from "@/components/ui/search-clear-button";
import { isWeb } from "@/constants/platform";
import {
  SETTINGS_SEARCH_ITEMS as SETTINGS_SEARCH_CATALOG,
  matchesSettingsSearchTerms,
  parseSettingsSearchTerms,
  type SettingsSearchItem,
} from "@/screens/settings-search-catalog";

const ThemedSearch = withUnistyles(Search);

const ThemedTextInput = withUnistyles(TextInput);

const searchIconProps = (theme: {
  colors: { foregroundMuted: string };
  iconSize: { md: number };
}) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.md,
});

const searchInputProps = (theme: { colors: { foregroundMuted: string } }) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

export function SettingsSearchOverview({
  onSelectItem,
  isDeveloperMode,
}: {
  onSelectItem: (item: SettingsSearchItem) => void;
  isDeveloperMode: boolean;
}) {
  const [query, setQuery] = useState("");
  const clearQuery = useCallback(() => setQuery(""), []);
  const normalizedQuery = query.trim().toLowerCase();
  const searchTerms = useMemo(() => parseSettingsSearchTerms(normalizedQuery), [normalizedQuery]);
  const results = useMemo(() => {
    // Every whitespace-separated term has to match, so "brain https" narrows
    // instead of looking for that literal string and finding nothing.
    return SETTINGS_SEARCH_CATALOG.filter((item) => matchesSettingsSearchTerms(item, searchTerms));
  }, [searchTerms]);
  const groupedResults = useMemo(() => {
    const groups = new Map<string, SettingsSearchItem[]>();
    for (const item of results) {
      const key = `${item.scope} · ${item.category}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()];
  }, [results]);
  let resultBody: ReactNode;

  if (!normalizedQuery) {
    // The section menu directly follows this overview on compact layouts, so
    // it is already the browse affordance. Keeping a second empty-state CTA
    // here created a large, redundant gap before the menu.
    resultBody = null;
  } else if (groupedResults.length === 0) {
    resultBody = (
      <View style={searchOverviewStyles.emptyState}>
        <Text style={searchOverviewStyles.emptyTitle}>No settings found</Text>
        <Text style={searchOverviewStyles.emptyText}>
          Try a broader term or search by category.
        </Text>
      </View>
    );
  } else {
    resultBody = (
      <View style={searchOverviewStyles.results}>
        {groupedResults.map(([group, items]) => (
          <View key={group} style={searchOverviewStyles.group}>
            <Text style={searchOverviewStyles.groupLabel}>{group}</Text>
            {items.map((item) => (
              <SettingsSearchResultRow
                key={item.id}
                item={item}
                onSelectItem={onSelectItem}
                isDeveloperMode={isDeveloperMode}
              />
            ))}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={searchOverviewStyles.container} testID="settings-search-overview">
      <View style={searchOverviewStyles.searchBox}>
        <ThemedSearch uniProps={searchIconProps} />
        <ThemedTextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="Search settings..."
          // @ts-expect-error - outlineStyle is web-only
          style={[searchOverviewStyles.input, isWeb && { outlineStyle: "none" }]}
          accessibilityLabel="Search settings"
          testID="settings-search-input"
          uniProps={searchInputProps}
        />
        {query ? <SearchClearButton onPress={clearQuery} /> : null}
      </View>
      {resultBody}
    </View>
  );
}

function SettingsSearchResultRow({
  item,
  onSelectItem,
  isDeveloperMode,
}: {
  item: SettingsSearchItem;
  onSelectItem: (item: SettingsSearchItem) => void;
  isDeveloperMode: boolean;
}) {
  const developerSettingUnavailable = item.developerOnly && !isDeveloperMode;
  const handlePress = useCallback(() => {
    onSelectItem(item);
  }, [item, onSelectItem]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={developerSettingUnavailable}
      style={searchOverviewStyles.resultRow}
      testID={`settings-search-result-${item.id}`}
    >
      <View style={searchOverviewStyles.resultContent}>
        <Text style={searchOverviewStyles.resultTitle}>{item.title}</Text>
        <Text style={searchOverviewStyles.resultDescription}>{item.description}</Text>
        {developerSettingUnavailable ? (
          <Text style={searchOverviewStyles.resultDescription}>
            Enable Developer mode to edit this setting
          </Text>
        ) : null}
      </View>
      <View style={searchOverviewStyles.badges}>
        <Text style={searchOverviewStyles.badge}>{item.scope}</Text>
        <Text style={searchOverviewStyles.badge}>{item.group}</Text>
        <Text style={searchOverviewStyles.badge}>{item.audience}</Text>
        {item.advanced ? <Text style={searchOverviewStyles.badge}>Advanced</Text> : null}
      </View>
    </Pressable>
  );
}

const searchOverviewStyles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[6],
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 40,
    paddingHorizontal: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  input: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[1],
  },
  results: {
    gap: theme.spacing[4],
  },
  group: {
    gap: theme.spacing[2],
  },
  groupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 68,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  resultRowHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  resultRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  resultContent: {
    flex: 1,
    gap: theme.spacing[1],
  },
  resultTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  resultDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
    maxWidth: 150,
  },
  badge: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
  emptyState: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[8],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
