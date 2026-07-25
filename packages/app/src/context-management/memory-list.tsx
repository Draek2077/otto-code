import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { PersonalityMemoryEntryPayload } from "@otto-code/protocol/messages";
import { Brain, Check, Pencil, Plus, Trash2, X } from "@/components/icons/material-icons";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { confirmDialog } from "@/utils/confirm-dialog";
import { formatTokens } from "./format";
import type { PersonalityMemoryView } from "./use-personality-memory";

// Theme-reactive icon colors without useUnistyles (docs/unistyles.md).
const ThemedBrain = withUnistyles(Brain);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash = withUnistyles(Trash2);
const ThemedPlus = withUnistyles(Plus);
const ThemedCheck = withUnistyles(Check);
const ThemedX = withUnistyles(X);

const ROW_ICON_SIZE = 15;

interface ContextMemoryListProps {
  /** null when no personality is selected — the list says so rather than blanking. */
  view: PersonalityMemoryView | null;
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
 * The Memory tab: what one personality has learned, and — above it — the exact
 * text that gets injected because of it.
 *
 * The brief comes first and is shown verbatim, because "memory is only
 * trustworthy if it is inspectable" is the whole reason this panel exists rather
 * than a count in a settings dialog. It is the daemon's own composed string, not
 * a re-render of the rows below it, so the two cannot drift apart: if the budget
 * dropped three lessons, the brief says so and the rows still show all of them.
 *
 * Lessons are NOT a node in the Context tree next door. Tree rows open in the
 * file pane, and a lesson is a stored row rather than a file — a row that opened
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
        <Text style={styles.emptyText}>
          Pick a personality above to see what it has learned, and what that adds to every request
          it makes.
        </Text>
      </View>
    );
  }

  if (isLoading && !view) {
    return (
      <View style={styles.empty}>
        <View style={styles.loadingRow} testID="context-memory-loading">
          <ActivityIndicator size="small" />
          <Text style={styles.emptyText}>Reading what this personality remembers…</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.empty}>
        <Text style={styles.errorText} testID="context-memory-error">
          {`Could not read this personality's memory: ${error}`}
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
          <Text style={styles.emptyText} testID="context-memory-empty">
            {`${view?.personalityName ?? "This personality"} has not recorded anything yet. It ` +
              "records lessons itself as it works; you can also add one by hand."}
          </Text>
        ) : (
          entries.map((entry) => (
            <MemoryRow
              key={entry.id}
              entry={entry}
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
            accessibilityLabel="Add a lesson"
            onPress={startAdding}
            style={styles.addButton}
            testID="context-memory-add"
          >
            <ThemedPlus size={ROW_ICON_SIZE} style={styles.addIcon} />
            <Text style={styles.addLabel}>Add a lesson</Text>
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
function InjectedBrief({ view }: { view: PersonalityMemoryView }): ReactElement {
  return (
    <View style={styles.briefCard} testID="context-memory-brief">
      <View style={styles.briefHeader}>
        <ThemedBrain size={ROW_ICON_SIZE} style={styles.briefIcon} />
        <Text style={styles.briefTitle}>{`Injected for ${view.personalityName}`}</Text>
        <Text style={styles.briefTokens}>
          {view.brief.length === 0 ? "nothing" : `${formatTokens(view.briefTokens)} every request`}
        </Text>
      </View>
      {view.enabled ? null : (
        // A personality with memory switched off still HAS lessons; they are just
        // not sent. Saying nothing here would make the stored rows below look
        // like they were reaching the model.
        <Text style={styles.briefMuted}>
          Memory is switched off for this personality, so none of this is sent. The lessons are
          kept.
        </Text>
      )}
      {view.brief.length > 0 ? (
        <Text style={styles.briefText} selectable>
          {view.brief}
        </Text>
      ) : (
        <Text style={styles.briefMuted}>
          Nothing is added to this personality&apos;s context in this project.
        </Text>
      )}
      {view.briefOmittedCount > 0 ? (
        <Text style={styles.briefMuted}>
          {`${view.briefOmittedCount} of the lessons below did not fit the injection budget and ` +
            "are not being sent."}
        </Text>
      ) : null}
    </View>
  );
}

interface MemoryRowProps {
  entry: PersonalityMemoryEntryPayload;
  onSave: (input: { entryId: string; text?: string; scope?: string }) => Promise<string | null>;
  onDrop: (entryId: string) => Promise<string | null>;
  onWriteError: (error: string | null) => void;
}

function MemoryRow({ entry, onSave, onDrop, onWriteError }: MemoryRowProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isCompact = useIsCompactFormFactor();
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
        title: "Forget this lesson?",
        message: `"${truncate(entry.text)}" will be removed from this personality's memory.`,
        confirmLabel: "Forget",
        cancelLabel: "Cancel",
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
    // inside it — the canonical pattern from docs/hover.md. Putting hover on a
    // Pressable that contains Pressables makes the two state machines fight.
    <View
      style={styles.row}
      onPointerEnter={isWeb ? handlePointerEnter : undefined}
      onPointerLeave={isWeb ? handlePointerLeave : undefined}
      testID={`context-memory-row-${entry.id}`}
    >
      <Text style={styles.rowText}>{entry.text}</Text>
      <View style={styles.rowMeta}>
        <Text style={styles.rowScope}>
          {entry.scope === "global" ? "Everywhere" : "This project"}
        </Text>
        {(entry.reinforcedCount ?? 1) > 1 ? (
          <Text style={styles.rowScope}>{`Learned ${entry.reinforcedCount} times`}</Text>
        ) : null}
        {entry.transferredFrom ? (
          <Text style={styles.rowScope}>{`From ${entry.transferredFrom}`}</Text>
        ) : null}
        <View style={styles.rowSpacer} />
        {showActions ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit this lesson"
              onPress={startEditing}
              hitSlop={8}
              testID={`context-memory-edit-${entry.id}`}
            >
              <ThemedPencil size={ROW_ICON_SIZE} style={styles.rowAction} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Forget this lesson"
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
 * the user questions — the thing a diff review cannot do.
 */
function MemoryComposer({
  initialText,
  initialScope,
  onCommit,
  onCancel,
}: MemoryComposerProps): ReactElement {
  const [text, setText] = useState(initialText);
  const [scope, setScope] = useState(initialScope === "global" ? "global" : "project");
  const canCommit = text.trim().length > 0;

  const handleCommit = useCallback(() => {
    if (!canCommit) return;
    void onCommit(text.trim(), scope);
  }, [canCommit, onCommit, scope, text]);

  const scopeLabel = useMemo(() => (scope === "global" ? "Everywhere" : "This project"), [scope]);
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
        placeholder="What should this personality remember?"
        style={styles.composerInput}
        testID="context-memory-composer-input"
      />
      <View style={styles.composerActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Scope: ${scopeLabel}. Tap to change.`}
          onPress={toggleScope}
          style={styles.scopeToggle}
          testID="context-memory-composer-scope"
        >
          <Text style={styles.scopeToggleText}>{scopeLabel}</Text>
        </Pressable>
        <View style={styles.rowSpacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onCancel}
          hitSlop={8}
          testID="context-memory-composer-cancel"
        >
          <ThemedX size={ROW_ICON_SIZE} style={styles.rowAction} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save this lesson"
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
      backgroundColor: theme.colors.surface2,
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
