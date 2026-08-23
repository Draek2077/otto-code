import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { PersonalityMemoryEntryPayload } from "@otto-code/protocol/messages";
import { Check, Cognition, Pencil, Plus, Trash2, X } from "@/components/icons/material-icons";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { i18n } from "@/i18n/i18next";
import { confirmDialog } from "@/utils/confirm-dialog";
import { formatTokens } from "./format";
import type { ProfileMemoryView } from "./use-personality-memory";

// Theme-reactive icon colors without useUnistyles (docs/unistyles.md).
const ThemedCognition = withUnistyles(Cognition);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash = withUnistyles(Trash2);
const ThemedPlus = withUnistyles(Plus);
const ThemedCheck = withUnistyles(Check);
const ThemedX = withUnistyles(X);

const ROW_ICON_SIZE = 15;

interface ContextMemoryListProps {
  /** null when no personality is selected - the list says so rather than blanking. */
  view: ProfileMemoryView | null;
  isLoading: boolean;
  error: string | null;
  hasPersonalitySelected: boolean;
  onSaveEntry: (input: {
    entryId: string;
    text?: string;
    scope?: string;
  }) => Promise<string | null>;
  onDropEntry: (entryId: string) => Promise<string | null>;
  onAddEntry: (input: { text: string; scope: string }) => Promise<string | null>;
}

/**
 * The Memory tab: what one personality has learned, and - above it - the exact
 * text that gets injected because of it.
 *
 * The brief comes first and is shown verbatim, because "memory is only
 * trustworthy if it is inspectable" is the whole reason this panel exists rather
 * than a count in a settings dialog. It is the daemon's own composed string, not
 * a re-render of the rows below it, so the two cannot drift apart: if the budget
 * dropped three lessons, the brief says so and the rows still show all of them.
 *
 * Lessons are NOT a node in the Context tree next door. Tree rows open in the
 * file pane, and a lesson is a stored row rather than a file - a row that opened
 * a path that does not exist would be a worse lie than not being there at all.
 */
export function ContextMemoryList({
  view,
  isLoading,
  error,
  hasPersonalitySelected,
  onSaveEntry,
  onDropEntry,
  onAddEntry,
}: ContextMemoryListProps): ReactElement {
  const { t } = useTranslation();
  const listRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(listRef, { enabled: isWeb });
  const [adding, setAdding] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const handleAdd = useCallback(
    async (text: string, scope: string) => {
      const failure = await onAddEntry({ text, scope });
      setWriteError(failure);
      if (!failure) setAdding(false);
    },
    [onAddEntry],
  );
  const startAdding = useCallback(() => setAdding(true), []);
  const cancelAdding = useCallback(() => setAdding(false), []);

  if (!hasPersonalitySelected) {
    return (
      <View style={styles.empty} testID="context-memory-no-personality">
        <Text style={styles.emptyText}>{t("contextManagement.memory.noPersonality")}</Text>
      </View>
    );
  }

  if (isLoading && !view) {
    return (
      <View style={styles.empty}>
        <View style={styles.loadingRow} testID="context-memory-loading">
          <LoadingSpinner size="small" />
          <Text style={styles.emptyText}>{t("contextManagement.memory.loading")}</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.empty}>
        <Text style={styles.errorText} testID="context-memory-error">
          {t("contextManagement.memory.failed", { error })}
        </Text>
      </View>
    );
  }

  const entries = view?.entries ?? [];

  return (
    <View style={styles.listWrap}>
      <ScrollView
        ref={listRef}
        style={styles.list}
        testID="context-memory-list"
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!isWeb}
      >
        {view ? <InjectedBrief view={view} /> : null}

        {writeError ? (
          <Text style={styles.errorText} testID="context-memory-write-error">
            {writeError}
          </Text>
        ) : null}

        {entries.length === 0 ? (
          // Inset to the same gutter as the brief card above and the rows below.
          // Full-bleed here reads as a different surface rather than the same
          // list continuing.
          <Text style={styles.listEmptyText} testID="context-memory-empty">
            {t("contextManagement.memory.emptyNamed", {
              name: view?.personalityName ?? t("contextManagement.memory.emptyFallbackName"),
            })}
          </Text>
        ) : (
          entries.map((entry) => (
            <MemoryRow
              key={entry.id}
              entry={entry}
              currentProjectRoot={view?.projectRoot ?? null}
              onSave={onSaveEntry}
              onDrop={onDropEntry}
              onWriteError={setWriteError}
            />
          ))
        )}

        {adding ? (
          <MemoryComposer
            initialText=""
            initialScope="project"
            onCommit={handleAdd}
            onCancel={cancelAdding}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("contextManagement.memory.add")}
            onPress={startAdding}
            style={styles.addButton}
            testID="context-memory-add"
          >
            <ThemedPlus size={ROW_ICON_SIZE} style={styles.addIcon} />
            <Text style={styles.addLabel}>{t("contextManagement.memory.add")}</Text>
          </Pressable>
        )}
      </ScrollView>
      {scrollbar.overlay}
    </View>
  );
}

/**
 * The injected text, verbatim, with its recurring cost. This block is the
 * feature's honesty: everything below it is storage, and this is what is
 * actually sent.
 */
function InjectedBrief({ view }: { view: ProfileMemoryView }): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.briefCard} testID="context-memory-brief">
      <View style={styles.briefHeader}>
        <ThemedCognition size={ROW_ICON_SIZE} style={styles.briefIcon} />
        <Text style={styles.briefTitle}>
          {t("contextManagement.memory.brief.title", { name: view.personalityName })}
        </Text>
        <Text style={styles.briefTokens}>
          {view.brief.length === 0
            ? t("contextManagement.memory.brief.nothing")
            : t("contextManagement.memory.brief.everyRequest", {
                tokens: formatTokens(view.briefTokens),
              })}
        </Text>
      </View>
      {view.enabled ? null : (
        // A personality with memory switched off still HAS lessons; they are just
        // not sent. Saying nothing here would make the stored rows below look
        // like they were reaching the model.
        <Text style={styles.briefMuted}>{t("contextManagement.memory.brief.disabled")}</Text>
      )}
      {view.brief.length > 0 ? (
        <Text style={styles.briefText} selectable>
          {view.brief}
        </Text>
      ) : (
        // "Nothing is injected" and "nothing is stored" are different facts, and
        // saying only the first while rows sit below it reads as a bug rather
        // than as scoping. When there ARE lessons, say why none of them apply.
        <Text style={styles.briefMuted}>
          {view.entries.length > 0
            ? t("contextManagement.memory.brief.emptyButStored", {
                count: view.entries.length,
              })
            : t("contextManagement.memory.brief.empty")}
        </Text>
      )}
      {view.briefOmittedCount > 0 ? (
        <Text style={styles.briefMuted}>
          {t("contextManagement.memory.brief.omitted", { count: view.briefOmittedCount })}
        </Text>
      ) : null}
    </View>
  );
}

interface MemoryRowProps {
  entry: PersonalityMemoryEntryPayload;
  /** The root the brief above was composed for; null when there is no project. */
  currentProjectRoot: string | null;
  onSave: (input: { entryId: string; text?: string; scope?: string }) => Promise<string | null>;
  onDrop: (entryId: string) => Promise<string | null>;
  onWriteError: (error: string | null) => void;
}

function MemoryRow({
  entry,
  currentProjectRoot,
  onSave,
  onDrop,
  onWriteError,
}: MemoryRowProps): ReactElement {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isCompact = useIsCompactFormFactor();
  // Which project this lesson reaches, from here. The brief above only carries
  // "Everywhere" plus this project's, so a row that says nothing more than "This
  // project" while the brief says nothing is indistinguishable from a bug.
  const reach = resolveReach(entry, currentProjectRoot);
  const reachesHere = reach === "global" || reach === "project";
  // Hover-to-show only works on web; on touch and on a phone the controls have
  // to be permanently visible or they are unreachable (see docs/hover.md).
  const showActions = isHovered || isNative || isCompact;

  const handleCommit = useCallback(
    async (text: string, scope: string) => {
      const failure = await onSave({ entryId: entry.id, text, scope });
      onWriteError(failure);
      if (!failure) setEditing(false);
    },
    [entry.id, onSave, onWriteError],
  );

  const handleDrop = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: i18n.t("contextManagement.memory.forgetDialog.title"),
        message: i18n.t("contextManagement.memory.forgetDialog.message", {
          lesson: truncate(entry.text),
        }),
        confirmLabel: i18n.t("contextManagement.memory.forgetDialog.confirm"),
        cancelLabel: i18n.t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      onWriteError(await onDrop(entry.id));
    })();
  }, [entry.id, entry.text, onDrop, onWriteError]);

  const startEditing = useCallback(() => setEditing(true), []);
  const cancelEditing = useCallback(() => setEditing(false), []);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  if (editing) {
    return (
      <MemoryComposer
        initialText={entry.text}
        initialScope={entry.scope}
        onCommit={handleCommit}
        onCancel={cancelEditing}
      />
    );
  }

  return (
    // Hover on a plain View with pointerenter/leave, actions in Pressables
    // inside it - the canonical pattern from docs/hover.md. Putting hover on a
    // Pressable that contains Pressables makes the two state machines fight.
    <View
      style={styles.row}
      onPointerEnter={isWeb ? handlePointerEnter : undefined}
      onPointerLeave={isWeb ? handlePointerLeave : undefined}
      testID={`context-memory-row-${entry.id}`}
    >
      <Text style={styles.rowText}>{entry.text}</Text>
      <View style={styles.rowMeta}>
        <Text style={reachesHere ? styles.rowScope : styles.rowScopeInert}>
          {t(`contextManagement.memory.scope.${reach}`)}
        </Text>
        {(entry.reinforcedCount ?? 1) > 1 ? (
          <Text style={styles.rowScope}>
            {t("contextManagement.memory.row.reinforced", { count: entry.reinforcedCount })}
          </Text>
        ) : null}
        {entry.transferredFrom ? (
          <Text style={styles.rowScope}>
            {t("contextManagement.memory.row.transferredFrom", { name: entry.transferredFrom })}
          </Text>
        ) : null}
        <View style={styles.rowSpacer} />
        {showActions ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("contextManagement.memory.row.edit")}
              onPress={startEditing}
              hitSlop={8}
              testID={`context-memory-edit-${entry.id}`}
            >
              <ThemedPencil size={ROW_ICON_SIZE} style={styles.rowAction} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("contextManagement.memory.row.forget")}
              onPress={handleDrop}
              hitSlop={8}
              testID={`context-memory-drop-${entry.id}`}
            >
              <ThemedTrash size={ROW_ICON_SIZE} style={styles.rowActionDestructive} />
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

interface MemoryComposerProps {
  initialText: string;
  initialScope: string;
  onCommit: (text: string, scope: string) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * A plain textarea plus a scope toggle. Deliberately not the Refine loop: Refine
 * works on a set of FILES and reviews a diff hunk by hunk, which earns its
 * complexity on a long document and is pure overhead on a two-sentence lesson.
 * The model-assisted path for improving a lesson is `review_lessons`, which asks
 * the user questions - the thing a diff review cannot do.
 */
function MemoryComposer({
  initialText,
  initialScope,
  onCommit,
  onCancel,
}: MemoryComposerProps): ReactElement {
  const { t } = useTranslation();
  const [text, setText] = useState(initialText);
  const [scope, setScope] = useState(initialScope === "global" ? "global" : "project");
  const canCommit = text.trim().length > 0;

  const handleCommit = useCallback(() => {
    if (!canCommit) return;
    void onCommit(text.trim(), scope);
  }, [canCommit, onCommit, scope, text]);

  const scopeLabel = useMemo(
    () =>
      scope === "global"
        ? t("contextManagement.memory.scope.global")
        : t("contextManagement.memory.scope.project"),
    [scope, t],
  );
  const toggleScope = useCallback(
    () => setScope((current) => (current === "global" ? "project" : "global")),
    [],
  );

  return (
    <View style={styles.composer} testID="context-memory-composer">
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        autoFocus
        placeholder={t("contextManagement.memory.composer.placeholder")}
        style={styles.composerInput}
        testID="context-memory-composer-input"
      />
      <View style={styles.composerActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("contextManagement.memory.scope.change", { scope: scopeLabel })}
          onPress={toggleScope}
          style={styles.scopeToggle}
          testID="context-memory-composer-scope"
        >
          <Text style={styles.scopeToggleText}>{scopeLabel}</Text>
        </Pressable>
        <View style={styles.rowSpacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.actions.cancel")}
          onPress={onCancel}
          hitSlop={8}
          testID="context-memory-composer-cancel"
        >
          <ThemedX size={ROW_ICON_SIZE} style={styles.rowAction} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("contextManagement.memory.composer.save")}
          disabled={!canCommit}
          onPress={handleCommit}
          hitSlop={8}
          testID="context-memory-composer-save"
        >
          <ThemedCheck
            size={ROW_ICON_SIZE}
            style={canCommit ? styles.rowActionAccent : styles.rowActionDisabled}
          />
        </Pressable>
      </View>
    </View>
  );
}

type MemoryReach = "global" | "project" | "elsewhere" | "unattached";

/**
 * How far a stored lesson actually reaches, seen from the project the brief was
 * composed for. The daemon filters project entries by comparing roots, so the
 * three "project" cases are not the same thing at all: this project's lesson is
 * injected, another project's is not, and one with no root is injected nowhere.
 *
 * `currentProjectRoot === null` means the daemon resolved no project (or is old
 * enough not to send the field). Nothing can be compared then, so every
 * project-scoped entry stays plain "This project" rather than being accused of
 * belonging elsewhere.
 */
function resolveReach(
  entry: PersonalityMemoryEntryPayload,
  currentProjectRoot: string | null,
): MemoryReach {
  if (entry.scope === "global") return "global";
  if (!entry.projectRoot) return "unattached";
  if (!currentProjectRoot) return "project";
  return normalizeRoot(entry.projectRoot) === normalizeRoot(currentProjectRoot)
    ? "project"
    : "elsewhere";
}

/** Mirrors the daemon's root comparison - trailing separators, slashes, case. */
function normalizeRoot(root: string): string {
  return root
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

// The sidebar shares Context Management's +2 compact bump.
function bump(size: number) {
  return { xs: size + 2, md: size };
}

const styles = StyleSheet.create((theme) => {
  const actionBase = { flexShrink: 0 } as const;
  return {
    listWrap: {
      flex: 1,
      minHeight: 0,
      position: "relative",
    },
    list: {
      flex: 1,
    },
    empty: {
      padding: theme.spacing[4],
      gap: theme.spacing[2],
    },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    emptyText: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.sm),
    },
    // The in-list variant. `empty` above wraps the whole-pane states and carries
    // its own padding; this one sits inside the scroller between the brief card
    // and the add row, so it has to match their gutter itself.
    listEmptyText: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.sm),
      paddingHorizontal: theme.spacing[3],
      paddingTop: theme.spacing[1],
      paddingBottom: theme.spacing[3],
    },
    errorText: {
      color: theme.colors.statusDanger,
      fontSize: bump(theme.fontSize.sm),
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
    },
    briefCard: {
      margin: theme.spacing[3],
      padding: theme.spacing[3],
      gap: theme.spacing[2],
      borderWidth: theme.borderWidth[1],
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      // surface1, not surface2: `border` is nearly identical to surface2 on
      // this theme, which swallows the card's own outline.
      backgroundColor: theme.colors.surface1,
    },
    briefHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    briefIcon: {
      color: theme.colors.accent,
      flexShrink: 0,
    },
    briefTitle: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.foreground,
      fontSize: bump(theme.fontSize.sm),
      fontWeight: "600",
    },
    briefTokens: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.xs),
      fontVariant: ["tabular-nums"],
      flexShrink: 0,
    },
    briefText: {
      // The injected prompt is code-adjacent: it is a literal payload, so it
      // takes the Code font setting like every other verbatim surface.
      color: theme.colors.mutedForeground,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      lineHeight: theme.lineHeight.diff,
    },
    briefMuted: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.xs),
      fontStyle: "italic",
    },
    row: {
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
      gap: theme.spacing[1],
      borderTopWidth: theme.borderWidth[1],
      borderTopColor: theme.colors.border,
    },
    rowText: {
      color: theme.colors.foreground,
      fontSize: bump(theme.fontSize.sm),
    },
    rowMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      // Fixed slot for the hover-revealed actions (docs/hover.md rule 4): if the
      // icons appearing changed this line's height, the row would shift out from
      // under the cursor and flicker between hovered and not.
      minHeight: 22,
    },
    rowScope: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.xs),
      flexShrink: 0,
    },
    // A lesson that is stored but not reaching this project. Dimmer than muted
    // rather than a warning colour: it is a fact about scope, not a fault.
    rowScopeInert: {
      color: theme.colors.mutedForeground,
      opacity: 0.6,
      fontSize: bump(theme.fontSize.xs),
      fontStyle: "italic",
      flexShrink: 0,
    },
    rowSpacer: {
      flex: 1,
      minWidth: 0,
    },
    rowAction: { ...actionBase, color: theme.colors.mutedForeground },
    rowActionAccent: { ...actionBase, color: theme.colors.accent },
    rowActionDisabled: { ...actionBase, color: theme.colors.border },
    rowActionDestructive: { ...actionBase, color: theme.colors.statusDanger },
    composer: {
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
      gap: theme.spacing[2],
      borderTopWidth: theme.borderWidth[1],
      borderTopColor: theme.colors.border,
    },
    composerInput: {
      minHeight: 72,
      color: theme.colors.foreground,
      fontSize: bump(theme.fontSize.sm),
      borderWidth: theme.borderWidth[1],
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[2],
      textAlignVertical: "top",
    },
    composerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    scopeToggle: {
      borderWidth: theme.borderWidth[1],
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
    },
    scopeToggleText: {
      color: theme.colors.foreground,
      fontSize: bump(theme.fontSize.xs),
    },
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[3],
      borderTopWidth: theme.borderWidth[1],
      borderTopColor: theme.colors.border,
    },
    addIcon: {
      color: theme.colors.mutedForeground,
      flexShrink: 0,
    },
    addLabel: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.sm),
    },
  };
});
