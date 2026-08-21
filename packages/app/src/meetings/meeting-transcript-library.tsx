import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { MeetingTranscript } from "@otto-code/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { TitlebarPopupSearchField } from "@/components/ui/titlebar-popup-search-field";
import { MessageSquarePlus, Pencil, Play, Stop, Trash2 } from "@/components/icons/material-icons";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSettings } from "@/hooks/use-settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useWorkspaceAttachmentsStore } from "@/attachments/workspace-attachments-store";
import { getDesktopHost, type DesktopLocalMeetingTranscript } from "@/desktop/host";
import { useZoomRecorderStatus } from "@/desktop/use-zoom-recorder-status";
import { ICON_SIZE } from "@/styles/theme";

const ThemedPencil = withUnistyles(Pencil);
const ThemedMessageSquarePlus = withUnistyles(MessageSquarePlus);
const ThemedTrash2 = withUnistyles(Trash2);

type LibraryMeetingTranscript =
  | (MeetingTranscript & { storage: "daemon" })
  | (DesktopLocalMeetingTranscript & { storage: "local" });

function formatOccurredAt(occurredAt: string): string {
  const date = new Date(occurredAt);
  return Number.isNaN(date.valueOf()) ? occurredAt : date.toLocaleString();
}

function localTranscriptStorageLabel(record: DesktopLocalMeetingTranscript): string {
  if (record.deliveryState === "waiting_for_secure_connection") {
    return "Kept on this desktop until secure delivery is available";
  }
  if (record.deliveryState === "delivery_failed") {
    return "Remote delivery failed. Kept on this desktop";
  }
  return "Kept on this desktop";
}

/**
 * The title-bar button owns the DropdownMenu trigger. This component owns the
 * anchored transcript popup and the separate selected-transcript editor.
 */
export function MeetingTranscriptLibrary({
  open,
  onClose,
  serverId,
  attachmentScopeKey,
}: {
  open: boolean;
  onClose: () => void;
  serverId: string;
  attachmentScopeKey: string;
}): ReactElement {
  const client = useHostRuntimeClient(serverId);
  const { settings, updateSettings } = useSettings();
  const { status: recorderStatus, refresh: refreshRecorderStatus } = useZoomRecorderStatus();
  const [records, setRecords] = useState<readonly LibraryMeetingTranscript[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LibraryMeetingTranscript | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [daemonRecords, localRecords] = await Promise.all([
        client ? client.meetingsTranscriptsList() : Promise.resolve([]),
        getDesktopHost()?.meetingTranscripts?.listLocal?.() ?? Promise.resolve([]),
      ]);
      setRecords(
        [
          ...daemonRecords.map((record) =>
            Object.assign({}, record, { storage: "daemon" as const }),
          ),
          ...localRecords.map((record) => Object.assign({}, record, { storage: "local" as const })),
        ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load meeting notes.");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return records;
    return records.filter((record) =>
      `${record.title}\n${record.content}`.toLocaleLowerCase().includes(query),
    );
  }, [records, search]);

  const openRecord = useCallback(
    (record: LibraryMeetingTranscript) => {
      onClose();
      setSelected(record);
      setDraftTitle(record.title);
      setDraftContent(record.content);
      setError(null);
    },
    [onClose],
  );

  const closeRecord = useCallback(() => {
    setSelected(null);
    setDraftTitle("");
    setDraftContent("");
    setError(null);
  }, []);

  const saveRecord = useCallback(async () => {
    const title = draftTitle.trim();
    const content = draftContent.trim();
    if (!selected || saving || !title || !content) return;
    setSaving(true);
    setError(null);
    try {
      const record =
        selected.storage === "daemon"
          ? await client?.meetingsTranscriptsUpdate({ id: selected.id, title, content })
          : await getDesktopHost()?.meetingTranscripts?.updateLocal?.({
              id: selected.id,
              title,
              content,
            });
      if (!record) {
        setError("This meeting note was deleted elsewhere.");
        return;
      }
      const next = { ...record, storage: selected.storage } as LibraryMeetingTranscript;
      setSelected(next);
      setDraftTitle(record.title);
      setDraftContent(record.content);
      setRecords((current) => current.map((item) => (item.id === record.id ? next : item)));
      closeRecord();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save meeting notes.");
    } finally {
      setSaving(false);
    }
  }, [client, closeRecord, draftContent, draftTitle, saving, selected]);

  const deleteRecord = useCallback(
    async (record: LibraryMeetingTranscript) => {
      // Close the anchored dropdown before opening the confirmation dialog. Two
      // active overlay managers here can deadlock Electron's focus handling.
      onClose();
      const confirmed = await confirmDialog({
        title: "Delete meeting notes?",
        message: `Delete "${record.title}" permanently? This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!confirmed) return;
      try {
        if (record.storage === "daemon") {
          await client?.meetingsTranscriptsDelete(record.id);
        } else {
          await getDesktopHost()?.meetingTranscripts?.deleteLocal?.(record.id);
        }
        setRecords((current) => current.filter((item) => item.id !== record.id));
        if (selected?.id === record.id) closeRecord();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to delete meeting notes.");
      }
    },
    [client, closeRecord, onClose, selected?.id],
  );

  const addToChat = useCallback(
    (record: LibraryMeetingTranscript) => {
      useWorkspaceAttachmentsStore.getState().addWorkspaceAttachment({
        scopeKey: attachmentScopeKey,
        attachment: {
          kind: "meeting_transcript",
          id: record.id,
          title: record.title,
          content: record.content,
          occurredAt: record.occurredAt,
        },
      });
      onClose();
    },
    [attachmentScopeKey, onClose],
  );

  const togglePaused = useCallback(() => {
    void updateSettings({ zoomRecorderPaused: !settings.zoomRecorderPaused });
  }, [settings.zoomRecorderPaused, updateSettings]);
  const takeOverRecorder = useCallback(async () => {
    await getDesktopHost()?.zoomRecorder?.takeOver?.();
    await refreshRecorderStatus();
  }, [refreshRecorderStatus]);
  const recorderConflict = recorderStatus.detail.includes("already running");
  const recorderActionIcon = recorderConflict || settings.zoomRecorderPaused ? Play : Stop;
  let recorderActionLabel = "Disable";
  if (recorderConflict) recorderActionLabel = "Take control";
  else if (settings.zoomRecorderPaused) recorderActionLabel = "Enable";
  const refreshVoid = useCallback(() => void refresh(), [refresh]);
  const saveRecordVoid = useCallback(() => void saveRecord(), [saveRecord]);

  const popupContent = useMemo(() => {
    if (loading) return <LibraryLoading />;
    if (error) return <LibraryError error={error} onRetry={refreshVoid} />;
    if (filteredRecords.length === 0) return <LibraryEmpty hasRecords={records.length > 0} />;
    return (
      <View style={styles.list}>
        {filteredRecords.map((record) => (
          <MeetingTranscriptRow
            key={record.id}
            record={record}
            onViewEdit={openRecord}
            onAddToChat={addToChat}
            onDelete={deleteRecord}
          />
        ))}
      </View>
    );
  }, [
    addToChat,
    deleteRecord,
    error,
    filteredRecords,
    loading,
    openRecord,
    records.length,
    refreshVoid,
  ]);

  // Pinned so the title, recorder control, and search stay visible while the
  // entry list scrolls underneath them.
  const popupHeader = useMemo(
    () => (
      <View style={styles.popupHeaderSection}>
        <View style={styles.popupHeader}>
          <Text style={styles.popupTitle}>Meeting notes</Text>
          <Button
            variant={recorderConflict ? "default" : "outline"}
            size="xs"
            leftIcon={recorderActionIcon}
            iconSize={ICON_SIZE.sm}
            textStyle={styles.recorderToggleText}
            onPress={recorderConflict ? takeOverRecorder : togglePaused}
          >
            {recorderActionLabel}
          </Button>
        </View>
        <TitlebarPopupSearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Search transcriptions"
          accessibilityLabel="Search meeting notes"
        />
      </View>
    ),
    [
      recorderActionIcon,
      recorderActionLabel,
      recorderConflict,
      search,
      setSearch,
      takeOverRecorder,
      togglePaused,
    ],
  );

  const editorHeader = useMemo<SheetHeader>(
    () => ({
      title: "Edit meeting notes",
      subtitle: selected ? formatOccurredAt(selected.occurredAt) : undefined,
    }),
    [selected],
  );
  const editorFooter = useMemo(
    () => (
      <View style={styles.editorFooter}>
        <Button size="sm" variant="secondary" onPress={closeRecord} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="sm"
          onPress={saveRecordVoid}
          disabled={saving || !draftTitle.trim() || !draftContent.trim()}
        >
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </View>
    ),
    [closeRecord, draftContent, draftTitle, saveRecordVoid, saving],
  );

  return (
    <>
      <DropdownMenuContent
        align="end"
        width={320}
        maxHeight={420}
        scrollable
        testID="meeting-transcript-library-popup"
        stickyHeader={popupHeader}
      >
        <View style={styles.popup}>{popupContent}</View>
      </DropdownMenuContent>
      <AdaptiveModalSheet
        header={editorHeader}
        visible={selected !== null}
        onClose={closeRecord}
        footer={editorFooter}
        desktopMaxWidth={720}
        desktopHeight={720}
        testID="meeting-transcript-editor"
      >
        <View style={styles.detail}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              value={draftTitle}
              onChangeText={setDraftTitle}
              editable={!saving}
              style={styles.titleInput}
              accessibilityLabel="Meeting notes title"
            />
          </View>
          <View style={styles.fieldContent}>
            <Text style={styles.fieldLabel}>Transcript</Text>
            <TextInput
              multiline
              value={draftContent}
              editable={false}
              textAlignVertical="top"
              style={styles.editor}
              accessibilityLabel="Meeting transcript"
            />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </AdaptiveModalSheet>
    </>
  );
}

function LibraryLoading(): ReactElement {
  return (
    <View style={styles.empty}>
      <LoadingSpinner />
      <Text style={styles.muted}>Loading meeting notes...</Text>
    </View>
  );
}

function LibraryError({ error, onRetry }: { error: string; onRetry: () => void }): ReactElement {
  return (
    <View style={styles.empty}>
      <Text style={styles.error}>{error}</Text>
      <Button variant="secondary" size="sm" onPress={onRetry}>
        Try again
      </Button>
    </View>
  );
}

function LibraryEmpty({ hasRecords }: { hasRecords: boolean }): ReactElement {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>
        {hasRecords ? "No meeting notes match your search." : "No transcripts yet."}
      </Text>
    </View>
  );
}

function MeetingTranscriptRow({
  record,
  onViewEdit,
  onAddToChat,
  onDelete,
}: {
  record: LibraryMeetingTranscript;
  onViewEdit: (record: LibraryMeetingTranscript) => void;
  onAddToChat: (record: LibraryMeetingTranscript) => void;
  onDelete: (record: LibraryMeetingTranscript) => Promise<void>;
}): ReactElement {
  const viewEdit = useCallback(() => onViewEdit(record), [onViewEdit, record]);
  const add = useCallback(() => onAddToChat(record), [onAddToChat, record]);
  const remove = useCallback(() => void onDelete(record), [onDelete, record]);
  return (
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {record.title}
        </Text>
        <Text style={styles.rowDate}>{formatOccurredAt(record.occurredAt)}</Text>
        {record.storage === "local" ? (
          <Text style={styles.rowStorage} numberOfLines={1}>
            {localTranscriptStorageLabel(record)}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowActions}>
        <ToolbarIconButton
          label="View or edit meeting notes"
          Icon={ThemedPencil}
          onPress={viewEdit}
          testID={`meeting-transcript-view-edit-${record.id}`}
        />
        <ToolbarIconButton
          label="Add meeting notes to chat"
          Icon={ThemedMessageSquarePlus}
          onPress={add}
          tone="accent"
          testID={`meeting-transcript-add-to-chat-${record.id}`}
        />
        <ToolbarIconButton
          label="Delete meeting notes"
          Icon={ThemedTrash2}
          onPress={remove}
          tone="destructive"
          testID={`meeting-transcript-delete-${record.id}`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  popup: {
    gap: 0,
  },
  popupHeaderSection: {
    gap: 0,
    paddingTop: theme.spacing[2],
  },
  popupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  popupTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  recorderToggleText: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm,
  },
  list: { paddingTop: theme.spacing[1] },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
  rowTitle: { color: theme.colors.foreground },
  rowDate: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  rowStorage: {
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  rowActions: {
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  detail: { flex: 1, minHeight: 0, gap: theme.spacing[3] },
  field: { gap: theme.spacing[1] },
  fieldContent: { flex: 1, minHeight: 0, gap: theme.spacing[1] },
  fieldLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  titleInput: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.sm,
  },
  editor: {
    flex: 1,
    minHeight: 320,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    fontSize: theme.fontSize.sm,
  },
  editorFooter: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  empty: {
    minHeight: 96,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
  },
  emptyState: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[3],
    alignItems: "center",
    justifyContent: "center",
  },
  emptyStateText: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
    textAlign: "center",
  },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
}));
