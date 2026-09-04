import { type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { ContextCategory, ContextPromptSection } from "@otto-code/protocol/messages";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";
import { useRef } from "react";
import { CATEGORY_LABEL_KEYS, formatTokens } from "./format";
import type { PromptPreviewQuery } from "./use-prompt-preview";

/**
 * One prompt section, read-only, in the pane where a file would otherwise be.
 *
 * The tree's file rows open the real file in the editor; its prompt rows open
 * this. Both answer "what is the model actually reading", and the difference is
 * only whether the text has a file behind it - so they share the pane rather
 * than living in a tab of their own.
 *
 * There is no edit affordance on purpose. Every section here is either composed
 * by Otto at request time or composed inside the provider's own process; neither
 * has a byte on disk to write back to.
 */
export interface PromptSectionViewProps {
  category: ContextCategory;
  query: PromptPreviewQuery;
}

export function PromptSectionView({ category, query }: PromptSectionViewProps): ReactElement {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(scrollRef, { enabled: isWeb });

  // The request is category-scoped, so anything that came back belongs to this
  // heading. Several blocks of one category are possible (context files), and
  // they read as one document.
  const sections = query.preview?.sections ?? [];
  const unmeasured = sections.length > 0 && sections.every((s) => s.visibility === "not_visible");
  const estTokens = query.preview?.estTokens ?? 0;

  return (
    <View style={styles.root} testID="context-prompt-section">
      {/* The heading is the whole toolbar: it names the section, states what it
          costs every request, and says outright that this is not editable. */}
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {t(CATEGORY_LABEL_KEYS[category])}
        </Text>
        <Text style={styles.readOnly}>{t("contextManagement.prompt.readOnly")}</Text>
        {sections.length > 0 && !unmeasured ? (
          <Text style={styles.tokens}>
            {t("contextManagement.prompt.sectionTokens", { tokens: formatTokens(estTokens) })}
          </Text>
        ) : null}
      </View>
      <View style={styles.body}>
        <PromptSectionBody
          query={query}
          unmeasured={unmeasured}
          scrollRef={scrollRef}
          scrollbar={scrollbar}
        />
      </View>
    </View>
  );
}

function PromptSectionBody({
  query,
  unmeasured,
  scrollRef,
  scrollbar,
}: {
  query: PromptPreviewQuery;
  unmeasured: boolean;
  scrollRef: React.RefObject<ScrollView | null>;
  scrollbar: ReturnType<typeof useWebScrollViewScrollbar>;
}): ReactElement {
  const { t } = useTranslation();

  if (query.isLoading) {
    return (
      <View style={styles.centered} testID="context-prompt-section-loading">
        <LoadingSpinner />
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

  // The disclosure, in the place the text would have been. An empty pane reads
  // as "the provider sends nothing here", which is the one wrong conclusion.
  if (unmeasured) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notVisible}>{t("contextManagement.prompt.notVisibleBody")}</Text>
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
    <View style={styles.scrollWrap}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!isWeb}
      >
        {keySections(sections).map(({ key, section }) => (
          // Several blocks of one category read as one document, so the label
          // only appears when there is more than one thing to tell apart.
          <View key={key} style={styles.block}>
            {sections.length > 1 ? <Text style={styles.blockLabel}>{section.label}</Text> : null}
            <Text style={styles.text} selectable>
              {section.text ?? ""}
            </Text>
          </View>
        ))}
      </ScrollView>
      {scrollbar.overlay}
    </View>
  );
}

/**
 * A label does not identify a block on its own - a category can emit several
 * with the same name - so repeats carry an occurrence ordinal. Keys are built up
 * front rather than from the map index: the list reorders when a what-if changes
 * what is loaded, and an index key would hold the old text under the new label.
 */
function keySections(
  sections: readonly ContextPromptSection[],
): { key: string; section: ContextPromptSection }[] {
  const seen = new Map<string, number>();
  return sections.map((section) => {
    const nth = seen.get(section.label) ?? 0;
    seen.set(section.label, nth + 1);
    return { key: nth === 0 ? section.label : `${section.label}#${nth}`, section };
  });
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    flexShrink: 1,
    minWidth: 0,
  },
  readOnly: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
    fontStyle: "italic",
  },
  tokens: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  scrollWrap: {
    flex: 1,
    minHeight: 0,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: theme.spacing[3],
    gap: theme.spacing[3],
  },
  block: {
    gap: theme.spacing[1],
  },
  blockLabel: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  // Prompt text is a code surface: `fontSize.code` honours the user's Code font
  // setting, which `fontSize.xs` silently ignores.
  text: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
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
  notVisible: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
    textAlign: "center",
    maxWidth: 420,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
