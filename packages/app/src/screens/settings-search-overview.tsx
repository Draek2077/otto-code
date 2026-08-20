// The settings search overview: the local search item list (merged with
// the generated settings-search-catalog), the overview surface, and its
// result rows, with their own stylesheet. Extracted from
// settings-screen.tsx, which renders the overview from its desktop
// content at one registration point.
import { useCallback, useMemo, useState } from "react";
import { ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Search } from "@/components/icons/material-icons";
import { SearchClearButton } from "@/components/ui/search-clear-button";
import { isWeb } from "@/constants/platform";
import { type HostSectionSlug, type SettingsSectionSlug } from "@/utils/host-routes";
import { SETTINGS_SEARCH_ITEMS as SETTINGS_SEARCH_CATALOG } from "@/screens/settings-search-catalog";

interface SettingsSearchItem {
  id: string;
  title: string;
  description: string;
  keywords: string;
  scope: "App" | "Desktop" | "Host";
  section: SettingsSectionSlug | HostSectionSlug;
  host: boolean;
  developerOnly?: boolean;
}

export const SETTINGS_SEARCH_ITEMS: readonly SettingsSearchItem[] = [
  {
    id: "interface-mode",
    title: "Interface mode",
    description: "Choose User or Developer mode",
    keywords: "user developer interface",
    scope: "App",
    section: "general",
    host: false,
  },
  {
    id: "app-start",
    title: "App starts on",
    description: "Choose the first screen Otto opens",
    keywords: "startup home dashboard workspace",
    scope: "App",
    section: "general",
    host: false,
  },
  {
    id: "language",
    title: "Language",
    description: "Choose the app language",
    keywords: "locale translation",
    scope: "App",
    section: "general",
    host: false,
  },
  {
    id: "send-behavior",
    title: "Default send",
    description: "Choose whether Enter interrupts or queues",
    keywords: "enter interrupt queue message",
    scope: "App",
    section: "general",
    host: false,
  },
  {
    id: "tool-call-detail",
    title: "Tool call display",
    description: "Show summary or full tool-call detail",
    keywords: "timeline tools detail",
    scope: "App",
    section: "general",
    host: false,
  },
  {
    id: "terminal-scrollback",
    title: "Terminal scrollback",
    description: "Lines kept in the terminal buffer",
    keywords: "terminal lines buffer",
    scope: "App",
    section: "general",
    host: false,
    developerOnly: true,
  },
  {
    id: "theme",
    title: "Theme",
    description: "Choose color mode and visual theme",
    keywords: "dark light color appearance",
    scope: "App",
    section: "appearance",
    host: false,
  },
  {
    id: "fonts",
    title: "Fonts",
    description: "Adjust interface, code, and terminal typography",
    keywords: "font size typeface accessibility",
    scope: "App",
    section: "appearance",
    host: false,
  },
  {
    id: "chat-layout",
    title: "Chat layout",
    description: "Adjust chat width, tabs, and message presentation",
    keywords: "chat width tabs layout messages",
    scope: "App",
    section: "appearance",
    host: false,
  },
  {
    id: "diff-presentation",
    title: "Diff presentation",
    description: "Choose line or structural review diffs",
    keywords: "difftastic semantic syntax aware changes review line structured",
    scope: "App",
    section: "appearance",
    host: false,
  },
  {
    id: "visualizer",
    title: "Visualizer",
    description: "Configure the agent visualizer",
    keywords: "graph nodes panels sound fps",
    scope: "App",
    section: "visualizer",
    host: false,
    developerOnly: true,
  },
  {
    id: "vim",
    title: "Vim keybindings",
    description: "Use Vim keybindings in the file editor",
    keywords: "editor keyboard",
    scope: "App",
    section: "editor" as SettingsSectionSlug,
    host: false,
    developerOnly: true,
  },
  {
    id: "desktop-window",
    title: "Window behavior",
    description: "Configure tray, startup, and quit behavior",
    keywords: "desktop tray minimize quit",
    scope: "Desktop",
    section: "general",
    host: false,
  },
  {
    id: "providers",
    title: "Providers",
    description: "Configure agent providers, models, and connections",
    keywords: "model api key server url agent inference llm",
    scope: "Host",
    section: "providers",
    host: true,
    developerOnly: true,
  },
  {
    id: "personalities",
    title: "Agent personalities",
    description: "Create reusable agent templates",
    keywords: "agents model prompt role voice",
    scope: "Host",
    section: "agents",
    host: true,
  },
  {
    id: "teams",
    title: "Agent teams",
    description: "Group personalities into reusable teams",
    keywords: "team members roles prompt",
    scope: "Host",
    section: "teams",
    host: true,
  },
  {
    id: "otto-tools",
    title: "Otto tools",
    description: "Choose which tools agents can use",
    keywords: "tools preview browser schedules artifacts",
    scope: "Host",
    section: "tools",
    host: true,
    developerOnly: true,
  },
  {
    id: "code-intelligence",
    title: "Code intelligence",
    description: "Configure language servers and code navigation",
    keywords: "lsp definition references diagnostics language",
    scope: "Host",
    section: "code",
    host: true,
    developerOnly: true,
  },
  {
    id: "brain",
    title: "Otto Brain",
    description: "Configure the local or remote model host",
    keywords: "local model host llama remote tls",
    scope: "Host",
    section: "brain",
    host: true,
    developerOnly: true,
  },
  {
    id: "storage",
    title: "Images from agents",
    description: "Manage host image retention and storage",
    keywords: "attachments screenshots disk cleanup",
    scope: "Host",
    section: "storage",
    host: true,
  },
  {
    id: "terminals",
    title: "Terminal profiles",
    description: "Configure host terminal commands and profiles",
    keywords: "shell command powershell hooks",
    scope: "Host",
    section: "terminals",
    host: true,
    developerOnly: true,
  },
  {
    id: "git-fetch",
    title: "Git fetch",
    description: "Control automatic fetches for active workspaces",
    keywords: "git ssh credentials private key remote origin background automatic interval",
    scope: "Host",
    section: "workspaces",
    host: true,
    developerOnly: true,
  },
  {
    id: "connections",
    title: "Connections",
    description: "Manage this device's connection to the host",
    keywords: "pair device qr remote",
    scope: "Host",
    section: "connections",
    host: true,
  },
];

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
  onSelectSection,
  onSelectHostSection,
  activeHostServerId,
  hasHosts,
  isDeveloperMode,
}: {
  onSelectSection: (section: SettingsSectionSlug) => void;
  onSelectHostSection: (section: HostSectionSlug) => void;
  activeHostServerId: string | null;
  hasHosts: boolean;
  isDeveloperMode: boolean;
}) {
  const [query, setQuery] = useState("");
  const clearQuery = useCallback(() => setQuery(""), []);
  const normalizedQuery = query.trim().toLowerCase();
  const results = useMemo(() => {
    // The inline list predates the complete catalog and remains only while
    // this large screen is incrementally decomposed. The catalog overwrites
    // duplicate ids, making it the effective source of truth now.
    const items = new Map(
      [...SETTINGS_SEARCH_ITEMS, ...SETTINGS_SEARCH_CATALOG].map((item) => [item.id, item]),
    );
    return [...items.values()].filter((item) => {
      if (!normalizedQuery) return false;
      return `${item.title} ${item.description} ${item.keywords} ${item.scope}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [normalizedQuery]);
  const groupedResults = useMemo(() => {
    const groups = new Map<string, SettingsSearchItem[]>();
    for (const item of results) {
      const key = `${item.scope} · ${item.section}`;
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
                onSelectSection={onSelectSection}
                onSelectHostSection={onSelectHostSection}
                activeHostServerId={activeHostServerId}
                hasHosts={hasHosts}
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
  onSelectSection,
  onSelectHostSection,
  activeHostServerId,
  hasHosts,
  isDeveloperMode,
}: {
  item: SettingsSearchItem;
  onSelectSection: (section: SettingsSectionSlug) => void;
  onSelectHostSection: (section: HostSectionSlug) => void;
  activeHostServerId: string | null;
  hasHosts: boolean;
  isDeveloperMode: boolean;
}) {
  const developerSettingUnavailable = item.developerOnly && !isDeveloperMode;
  const handlePress = useCallback(() => {
    if (item.host) {
      if (hasHosts && activeHostServerId) {
        onSelectHostSection(item.section as HostSectionSlug);
      }
      return;
    }
    onSelectSection(item.section as SettingsSectionSlug);
  }, [activeHostServerId, hasHosts, item, onSelectHostSection, onSelectSection]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={developerSettingUnavailable || (item.host && (!hasHosts || !activeHostServerId))}
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
        {item.developerOnly ? <Text style={searchOverviewStyles.badge}>Developer</Text> : null}
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
