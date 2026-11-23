import { useCallback, useEffect, useState } from "react";
import { NotebookPen } from "lucide-react-native";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import type { LocalMeetingNote, ZoomRecorderBridge } from "./bridge";
import { useZoomRecorderStatus } from "./use-status";

const SHEET_HEADER = { title: "Meeting notes" };
const Icon = withUnistyles(NotebookPen, (theme) => ({ color: theme.colors.foregroundMuted }));
const RECORDING_ICON = withUnistyles(NotebookPen, (theme) => ({ color: theme.colors.destructive }));

function useLocalNotes(bridge: ZoomRecorderBridge) {
  const [records, setRecords] = useState<LocalMeetingNote[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let unsubscribe: (() => void) | undefined;
    const load = () => {
      const current = ++revision;
      void bridge
        .listTranscripts()
        .then((notes) => {
          if (!disposed && current === revision) {
            setRecords(notes);
            setError("");
          }
          return undefined;
        })
        .catch(() => {
          if (!disposed && current === revision) setError("Could not read meeting notes.");
        });
    };
    void listenToDesktopEvent("zoom-recorder-transcript-saved", load)
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
        return undefined;
      })
      .catch(() => undefined);
    load();
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [bridge]);
  return { records, setRecords, error };
}

function MeetingNote({
  note,
  onDelete,
  onRename,
}: {
  note: LocalMeetingNote;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const showRename = useCallback(() => setRenaming(true), []);
  const closeRename = useCallback(() => setRenaming(false), []);
  const rename = useCallback(
    (title: string) => onRename(note.id, title.trim()),
    [note.id, onRename],
  );
  const copy = useCallback(() => copyToClipboard(note.content), [note.content]);
  const remove = useCallback(() => onDelete(note.id), [note.id, onDelete]);
  return (
    <View style={styles.note}>
      <Text style={styles.title}>{note.title}</Text>
      <Text selectable style={styles.transcript}>
        {note.content}
      </Text>
      <View style={styles.actions}>
        <Button variant="secondary" onPress={showRename}>
          Rename
        </Button>
        <Button variant="secondary" onPress={copy}>
          Copy transcript
        </Button>
        <Button variant="destructive" onPress={remove}>
          Delete
        </Button>
      </View>
      {renaming ? (
        <AdaptiveRenameModal
          visible
          title="Rename meeting notes"
          initialValue={note.title}
          maxLength={160}
          onClose={closeRename}
          onSubmit={rename}
        />
      ) : null}
    </View>
  );
}

function MeetingNotes({ bridge }: { bridge: ZoomRecorderBridge }) {
  const { records, setRecords, error } = useLocalNotes(bridge);
  const [selection, setSelection] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const selected = records?.find(({ id }) => id === selection) ?? records?.[0];
  const rename = useCallback(
    async (id: string, title: string) => {
      const updated = await bridge.updateTranscript({ id, title });
      if (!updated) throw new Error("This transcript is no longer available.");
      setRecords((previous) => previous?.map((note) => (note.id === id ? updated : note)) ?? null);
    },
    [bridge, setRecords],
  );
  const remove = useCallback(
    async (id: string) => {
      if (
        !(await confirmDialog({
          title: "Delete meeting notes?",
          message: "This removes the transcript from this computer.",
          confirmLabel: "Delete",
          destructive: true,
        }))
      )
        return;
      try {
        await bridge.deleteTranscript(id);
        setRecords((previous) => previous?.filter((item) => item.id !== id) ?? null);
        setDeleteError("");
      } catch {
        setDeleteError("Could not delete the transcript.");
      }
    },
    [bridge, setRecords],
  );

  return (
    <View style={styles.library}>
      {error || deleteError ? <Alert variant="error" description={error || deleteError} /> : null}
      {records === null && !error ? <Text style={styles.muted}>Loading transcripts…</Text> : null}
      {records?.length === 0 ? (
        <Text style={styles.muted}>
          No meeting notes yet. Enable Zoom recording in General settings.
        </Text>
      ) : null}
      <View style={styles.actions}>
        {records?.map(({ id, title, occurredAt }) => (
          <NoteSelector
            key={id}
            id={id}
            label={`${title} · ${new Date(occurredAt).toLocaleString()}`}
            onSelect={setSelection}
            active={selected?.id === id}
          />
        ))}
      </View>
      {selected ? (
        <MeetingNote key={selected.id} note={selected} onDelete={remove} onRename={rename} />
      ) : null}
    </View>
  );
}

function NoteSelector({
  id,
  label,
  onSelect,
  active,
}: {
  id: string;
  label: string;
  onSelect: (id: string) => void;
  active: boolean;
}) {
  const select = useCallback(() => onSelect(id), [id, onSelect]);
  return (
    <Button variant={active ? "default" : "secondary"} onPress={select}>
      {label}
    </Button>
  );
}

export function MeetingNotesButton() {
  const { bridge, status } = useZoomRecorderStatus();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  if (!bridge || !status?.available) return null;
  const StatusIcon = status.state === "recording" ? RECORDING_ICON : Icon;
  return (
    <>
      <ToolbarButton
        label={status.state === "recording" ? "Zoom recording · Meeting notes" : "Meeting notes"}
        onPress={show}
      >
        <StatusIcon size={16} />
      </ToolbarButton>
      {open ? (
        <AdaptiveModalSheet header={SHEET_HEADER} onClose={close} visible desktopMaxWidth={900}>
          <MeetingNotes bridge={bridge} />
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  library: { gap: theme.spacing[3] },
  note: {
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.md,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  title: { fontSize: theme.fontSize.base, color: theme.colors.foreground, fontWeight: "600" },
  muted: { color: theme.colors.foregroundMuted },
  transcript: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
}));
