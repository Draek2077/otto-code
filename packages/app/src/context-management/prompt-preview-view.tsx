import { type ReactElement } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { ContextPromptSection } from "@otto-code/protocol/messages";
import { CATEGORY_LABEL_KEYS, formatTokens } from "./format";
import type { PromptPreviewQuery } from "./use-prompt-preview";

/**
 * The assembled prompt, read-only.
 *
 * Everything here is derived from the same report the tree is drawn from, so
 * the two can never disagree about what is loaded. There is no edit affordance
 * on purpose: edits belong in the file pane, against one real file, where an
 * undo means something.
 */
export interface PromptPreviewViewProps {
  query: PromptPreviewQuery;
}

export function PromptPreviewView({ query }: PromptPreviewViewProps): ReactElement {
  const { t } = useTranslation();

  if (query.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (query.error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{query.error}</Text>
      </View>
    );
  }

  const sections = query.preview?.sections ?? [];
  if (sections.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t("contextManagement.prompt.empty")}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {/* The header states the total up front: the whole point of reading this
          is to feel how much of it there is. */}
      <Text style={styles.total}>
        {t("contextManagement.prompt.total", {
          tokens: formatTokens(query.preview?.estTokens ?? 0),
        })}
      </Text>
      {keySections(sections).map(({ key, section }) => (
        <PromptSection key={key} section={section} />
      ))}
    </ScrollView>
  );
}

/**
 * Category and label do not identify a section on their own — a provider can
 * emit several blocks of the same kind — so repeats carry an occurrence ordinal.
 * Keys are built up front rather than from the map index: the list reorders when
 * a what-if changes what is loaded, and an index key would hold the old text in
 * place under the new heading.
 */
function keySections(
  sections: readonly ContextPromptSection[],
): { key: string; section: ContextPromptSection }[] {
  const seen = new Map<string, number>();
  return sections.map((section) => {
    const base = `${section.category}:${section.label}`;
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    return { key: nth === 0 ? base : `${base}#${nth}`, section };
  });
}

function PromptSection({ section }: { section: ContextPromptSection }): ReactElement {
  const { t } = useTranslation();
  const categoryLabel = t(CATEGORY_LABEL_KEYS[section.category]);
  const unmeasured = section.visibility === "not_visible";

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionCategory}>{categoryLabel}</Text>
        <Text style={styles.sectionLabel} numberOfLines={1}>
          {section.label === section.category ? "" : section.label}
        </Text>
        <Text style={styles.sectionTokens}>
          {unmeasured ? "" : formatTokens(section.estTokens)}
        </Text>
      </View>
      {unmeasured ? (
        // The disclosure, in the place the text would have been. A section left
        // out entirely would read as "the provider sends nothing here".
        <Text style={styles.notVisible}>{t("contextManagement.prompt.notVisibleBody")}</Text>
      ) : (
        <Text style={styles.body} selectable>
          {section.text ?? ""}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flex: 1,
  },
  content: {
    padding: theme.spacing[3],
    gap: theme.spacing[3],
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  muted: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  total: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.sm,
  },
  section: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.muted,
  },
  sectionCategory: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  sectionLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
  },
  sectionTokens: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  // Prompt text is a code surface: `fontSize.code` honours the user's Code font
  // setting, which `fontSize.xs` silently ignores.
  body: {
    padding: theme.spacing[2],
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  notVisible: {
    padding: theme.spacing[2],
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
  },
}));
