import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { MemoryAction, MemoryView } from "@getpaseo/protocol/otto/profile-memory";
import { useAgentProfiles } from "@/agent-profiles";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useFetchQuery } from "@/data/query";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SettingsSelect } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { styles } from "../context-management/styles";

type Entry = MemoryView["entries"][number];
type Edit = Extract<MemoryAction, { kind: "add" | "edit" | "forget" }>;
const scopes = [
  { value: "project", label: "This project" },
  { value: "global", label: "All projects on this host" },
];
export function ProfileMemorySelector({
  hostId,
  profileId,
  select,
}: {
  hostId: string;
  profileId: string;
  select: (id: string) => void;
}) {
  const { profiles } = useAgentProfiles(hostId);
  const options = useMemo(
    () => [
      { value: "", label: "Everyone" },
      ...(profiles ?? []).map((p) => ({ value: p.id, label: p.name })),
    ],
    [profiles],
  );
  return (
    <SettingsSelect label="Profile" value={profileId} options={options} onValueChange={select} />
  );
}
export function ProfileMemoryPane({
  hostId,
  workspaceId,
  profileId,
}: {
  hostId: string;
  workspaceId: string;
  profileId: string;
}) {
  return (
    <View style={styles.preview}>
      {profileId ? (
        <ProfileLessons
          key={profileId}
          hostId={hostId}
          workspaceId={workspaceId}
          profileId={profileId}
        />
      ) : (
        <Text style={styles.caption}>Choose a Profile to see what it remembers.</Text>
      )}
    </View>
  );
}
function ProfileLessons({
  hostId,
  workspaceId,
  profileId,
}: {
  hostId: string;
  workspaceId: string;
  profileId: string;
}) {
  const client = useHostRuntimeClient(hostId);
  const read = useFetchQuery({
    dataShape: "value",
    queryKey: ["ottoProfileMemory", hostId, workspaceId, profileId],
    staleTimeMs: 0,
    retry: false,
    enabled: !!client,
    queryFn: async () => {
      if (!client) throw new Error("Host disconnected.");
      return client.profileMemory({ kind: "view", profileId, workspaceId });
    },
  });
  const [edit, setEdit] = useState<Entry | "new" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const { refetch } = read;
  const write = useCallback(
    async (action: Edit) => {
      if (lock.current || !client) return;
      lock.current = true;
      setBusy(true);
      setError("");
      try {
        await client.profileMemory(action);
        setEdit(null);
        await refetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : "The host could not update this lesson.");
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [client, refetch],
  );
  const create = useCallback(() => setEdit("new"), []);
  const cancel = useCallback(() => setEdit(null), []);
  const forget = useCallback(
    async (entry: Entry) => {
      if (
        await confirmDialog({
          title: "Forget lesson?",
          message: entry.text,
          confirmLabel: "Forget",
          cancelLabel: "Keep lesson",
          destructive: true,
        })
      )
        await write({
          kind: "forget",
          profileId,
          workspaceId,
          expectedUpdatedAt: entry.updatedAt,
          entryId: entry.id,
        });
    },
    [profileId, workspaceId, write],
  );
  return (
    <View style={styles.preview}>
      {read.error || error ? (
        <Alert variant="error" description={error || "Lessons could not be read on this host."} />
      ) : null}
      {read.data ? (
        <>
          <Text style={styles.caption}>
            {read.data.enabled
              ? "Injected into new sessions · " + read.data.brief.estTokens + " estimated tokens"
              : "Memory is turned off for this Profile."}
          </Text>
          {read.data.brief.text ? (
            <Text selectable style={styles.code}>
              {read.data.brief.text}
            </Text>
          ) : null}
          {read.data.entries.map((entry) => (
            <LessonRow
              key={entry.id}
              entry={entry}
              edit={setEdit}
              forget={forget}
              busy={busy || !!edit}
            />
          ))}
          {edit ? (
            <LessonForm
              key={edit === "new" ? "new" : edit.id}
              entry={edit === "new" ? null : edit}
              profileId={profileId}
              workspaceId={workspaceId}
              write={write}
              cancel={cancel}
              busy={busy}
            />
          ) : (
            <Button size="sm" onPress={create}>
              Add lesson
            </Button>
          )}
        </>
      ) : null}
    </View>
  );
}
function LessonRow({
  entry,
  edit,
  forget,
  busy,
}: {
  entry: Entry;
  edit: (entry: Entry) => void;
  forget: (entry: Entry) => Promise<void>;
  busy: boolean;
}) {
  const open = useCallback(() => edit(entry), [edit, entry]);
  const drop = useCallback(() => {
    void forget(entry);
  }, [entry, forget]);
  return (
    <View style={styles.preview}>
      <Text selectable style={styles.caption}>
        {entry.scope === "global" ? "All projects" : entry.projectRoot}
      </Text>
      <Text selectable style={styles.code}>
        {entry.text}
      </Text>
      <View style={styles.actions}>
        <Button variant="outline" size="sm" onPress={open} disabled={busy}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onPress={drop} disabled={busy}>
          Forget
        </Button>
      </View>
    </View>
  );
}
function LessonForm({
  entry,
  profileId,
  workspaceId,
  write,
  cancel,
  busy,
}: {
  entry: Entry | null;
  profileId: string;
  workspaceId: string;
  write: (action: Edit) => Promise<void>;
  cancel: () => void;
  busy: boolean;
}) {
  const [text, setText] = useState(entry?.text ?? "");
  const [scope, setScope] = useState<Entry["scope"]>(entry?.scope ?? "project");
  const change = useCallback(
    (value: string) => setScope(value === "global" ? "global" : "project"),
    [],
  );
  const save = useCallback(
    () =>
      void write(
        entry
          ? {
              kind: "edit",
              expectedUpdatedAt: entry.updatedAt,
              entryId: entry.id,
              text,
              scope,
              profileId,
              workspaceId,
            }
          : { kind: "add", text, scope, profileId, workspaceId },
      ),
    [entry, profileId, workspaceId, scope, text, write],
  );
  return (
    <View style={styles.preview}>
      <Field label="Lesson">
        <FormTextInput
          accessibilityLabel="Lesson"
          multiline
          initialValue={entry?.text ?? ""}
          maxLength={1200}
          onChangeText={setText}
        />
      </Field>
      <SettingsSelect label="Applies to" value={scope} options={scopes} onValueChange={change} />
      <View style={styles.actions}>
        <Button size="sm" onPress={save} disabled={busy || !text.trim()}>
          Save lesson
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onPress={cancel}>
          Cancel
        </Button>
      </View>
    </View>
  );
}
