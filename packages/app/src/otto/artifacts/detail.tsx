import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { usePaseo, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  readArtifact,
  changeArtifact,
  type ArtifactRef,
  type ArtifactCommand,
  type ArtifactDocument,
} from "@getpaseo/plugin/otto/artifacts";
import { useFetchQuery } from "@/data/query";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { ArtifactHtmlView } from "./html-view";
import { exportArtifact } from "./export";
import {
  artifactDraftFor,
  releaseArtifactDraft,
  type ArtifactDraft,
  type ArtifactFields,
} from "./model";
import { styles } from "./styles";
import { ReviewModelPicker } from "../knowledge/review-model-picker";

const textArea = { minHeight: 100, textAlignVertical: "top" } as const;
export function ArtifactTextField({
  label,
  value,
  onChange,
  multiline = false,
  disabled = false,
  epoch = 0,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  multiline?: boolean;
  disabled?: boolean;
  epoch?: number;
}) {
  return (
    <Field label={label}>
      <FormTextInput
        accessibilityLabel={label}
        initialValue={value}
        resetKey={epoch}
        onChangeText={onChange}
        multiline={multiline}
        editable={!disabled}
        style={multiline ? textArea : undefined}
      />
    </Field>
  );
}
function DraftField({
  draft,
  field,
  label,
  multiline = false,
}: {
  draft: ArtifactDraft;
  field: keyof ArtifactFields;
  label: string;
  multiline?: boolean;
}) {
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const edit = useCallback((value: string) => draft.edit(field, value), [draft, field]);
  return (
    <ArtifactTextField
      label={label}
      value={state.fields[field]}
      onChange={edit}
      multiline={multiline}
      disabled={state.busy}
      epoch={state.epoch}
    />
  );
}
function consent(command: ArtifactCommand) {
  const messages: Partial<Record<ArtifactCommand["type"], string>> = {
    recover_lock:
      "Verify that every writer on every daemon using this store has stopped. Recover this inspected empty lock? The old lock is retained; this does not retry the failed write.",
    regenerate:
      "Regeneration can change the artifact's design. The last valid output is retained if generation fails. Continue?",
    repair:
      "Restore the last valid output? The current external file will be retained as a recovery file.",
    delete:
      "Delete this artifact from its owning host? This removes its stored output and run history.",
    move: "Move this artifact to the selected location on the same host? This does not publish it or change the project's default.",
  };
  const message = messages[command.type];
  return message
    ? confirmDialog({
        title: "Artifacts",
        message,
        confirmLabel: "Continue",
        cancelLabel: "Cancel",
        destructive: command.type === "delete",
      })
    : Promise.resolve(true);
}
interface DetailProps {
  reference: ArtifactRef;
  active: boolean;
  changed(): void;
  closed(): void;
  navigation: PluginSurfaceProps["navigation"];
}
export function ArtifactDetail(props: DetailProps) {
  const read = useRpc(readArtifact);
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: [
      "ottoArtifacts",
      props.reference.scope.hostId,
      props.reference.scope.target.id,
      props.reference.location,
      props.reference.id,
    ],
    enabled: props.active,
    retry: false,
    refetchInterval: props.active ? 5000 : false,
    queryFn: async () => {
      const result = await read(props.reference);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  if (query.error) return <Alert variant="error" description={query.error.message} />;
  if (!query.data) return <Text style={styles.muted}>Loading artifact...</Text>;
  return <ArtifactDetailBody {...props} document={query.data} />;
}
function useArtifactActions(props: DetailProps & { document: ArtifactDocument }) {
  const owner = usePaseo(),
    write = useRpc(changeArtifact),
    read = useRpc(readArtifact);
  const key = JSON.stringify(props.reference);
  const draft = useMemo(
    () => artifactDraftFor(owner, key, props.document),
    [owner, key, props.document],
  );
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  useEffect(() => {
    if (props.active) return draft.activate();
  }, [draft, props.active]);
  useEffect(() => draft.external(props.document), [draft, props.document]);
  const refreshRead = useCallback(async () => {
    const result = await read(props.reference);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }, [read, props.reference]);
  const reload = useCallback(() => {
    void draft.reload(refreshRead, () =>
      confirmDialog({
        title: "Reload saved artifact?",
        message: "Discard the local draft and read the current output?",
        confirmLabel: "Reload",
        cancelLabel: "Keep draft",
      }),
    );
  }, [draft, refreshRead]);
  const execute = useCallback(
    async (command: ArtifactCommand) => {
      const success = await draft.execute(command, {
        confirm: () => consent(command),
        write: async (action, expectedRevision) => {
          const result = await write({ ...props.reference, expectedRevision, command: action });
          if (!result.ok) throw new Error(result.error.message);
          if (!result.value.artifact) return null;
          const next = await read({ ...props.reference, location: result.value.artifact.location });
          if (!next.ok) throw new Error(next.error.message);
          return next.value;
        },
      });
      if (!success) return;
      props.changed();
      if (command.type === "delete" || command.type === "move") {
        releaseArtifactDraft(owner, key);
        props.closed();
      }
    },
    [draft, write, read, props, owner, key],
  );
  return { draft, state, execute, reload };
}
function ArtifactLifecycleActions({
  artifact,
  disabled,
  actions,
}: {
  artifact: ArtifactDocument["artifact"];
  disabled: boolean;
  actions: {
    cancel(): void;
    regenerate(): void;
    repair(): void;
    moveHost(): void;
    moveRepo(): void;
    remove(): void;
  };
}) {
  return (
    <View style={styles.actions}>
      {artifact.status === "generating" ? (
        <Button variant="outline" disabled={disabled} onPress={actions.cancel}>
          Cancel generation
        </Button>
      ) : (
        <Button variant="outline" disabled={disabled} onPress={actions.regenerate}>
          Regenerate design
        </Button>
      )}
      {artifact.repairAvailable ? (
        <Button
          variant="outline"
          disabled={disabled || artifact.status === "generating"}
          onPress={actions.repair}
        >
          Repair
        </Button>
      ) : null}
      {artifact.location !== "host" ? (
        <Button
          variant="outline"
          disabled={disabled || artifact.status === "generating"}
          onPress={actions.moveHost}
        >
          Move to host
        </Button>
      ) : null}
      {artifact.location !== "repository" ? (
        <Button
          variant="outline"
          disabled={disabled || artifact.status === "generating"}
          onPress={actions.moveRepo}
        >
          Move to repository
        </Button>
      ) : null}
      <Button
        variant="destructive"
        disabled={disabled || artifact.status === "generating"}
        onPress={actions.remove}
      >
        Delete artifact
      </Button>
    </View>
  );
}
function ArtifactDetailBody(props: DetailProps & { document: ArtifactDocument }) {
  const { draft, state, execute, reload } = useArtifactActions(props);
  const [feedback, setFeedback] = useState("");
  const saved = state.latest,
    artifact = saved.artifact;
  const disabled = state.busy || state.blocked || !props.active;
  const save = useCallback(
    () =>
      void execute({
        type: "metadata",
        name: state.fields.name,
        description: state.fields.description,
        starred: artifact.starred,
      }),
    [execute, state.fields.name, state.fields.description, artifact.starred],
  );
  const star = useCallback(
    () =>
      void execute({
        type: "metadata",
        name: state.fields.name,
        description: state.fields.description,
        starred: !artifact.starred,
      }),
    [execute, state.fields.name, state.fields.description, artifact.starred],
  );
  const data = useCallback(
    () => void execute({ type: "data", json: state.fields.json }),
    [execute, state.fields.json],
  );
  const regenerate = useCallback(
    () =>
      void execute({
        type: "regenerate",
        instruction: state.fields.instruction,
        ...(state.fields.provider && state.fields.model
          ? { selection: { provider: state.fields.provider, model: state.fields.model } }
          : {}),
        userApprovedDesignChange: true,
      }),
    [execute, state.fields],
  );
  const cancel = useCallback(() => void execute({ type: "cancel" }), [execute]);
  const recover = useCallback(() => {
    if (saved.lock)
      void execute({
        type: "recover_lock",
        expectedLockRevision: saved.lock.revision,
        userVerifiedNoActiveWriter: true,
      });
  }, [execute, saved.lock]);
  const repair = useCallback(
    () => void execute({ type: "repair", userApprovedRepair: true }),
    [execute],
  );
  const remove = useCallback(
    () => void execute({ type: "delete", userApprovedDelete: true }),
    [execute],
  );
  const moveHost = useCallback(
    () => void execute({ type: "move", destination: "host", userApprovedMove: true }),
    [execute],
  );
  const moveRepo = useCallback(
    () => void execute({ type: "move", destination: "repository", userApprovedMove: true }),
    [execute],
  );
  const lifecycleActions = useMemo(
    () => ({ cancel, regenerate, repair, moveHost, moveRepo, remove }),
    [cancel, regenerate, repair, moveHost, moveRepo, remove],
  );
  const copy = useCallback(async () => {
    setFeedback("Copying...");
    try {
      if (!saved.html) throw new Error("No output");
      await copyToClipboard(saved.html);
      setFeedback("HTML copied.");
    } catch {
      setFeedback("HTML could not be copied. Try again from this device.");
    }
  }, [saved.html]);
  const download = useCallback(async () => {
    setFeedback("Preparing export...");
    try {
      if (!saved.html) throw new Error("No output");
      await exportArtifact(saved.html, artifact.id);
      setFeedback("Export requested on this device.");
    } catch {
      setFeedback("Export is unavailable on this device. You can copy the HTML instead.");
    }
  }, [saved.html, artifact.id]);
  const openSource = useCallback(() => {
    if (artifact.source?.kind === "chat" && props.navigation)
      props.navigation.openAgent({
        agentId: artifact.source.agentId,
        serverId: props.reference.scope.hostId,
      });
  }, [artifact.source, props.navigation, props.reference.scope.hostId]);
  return (
    <View style={styles.content} testID="artifact-detail">
      <Text style={styles.title}>{artifact.name}</Text>
      <Text
        style={styles.muted}
      >{`${artifact.status} · ${artifact.location} · ${artifact.projectId}`}</Text>
      <Text
        selectable
        style={styles.muted}
      >{`Stored on the selected daemon host: ${saved.path}`}</Text>
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.notice ? <Alert description={state.notice} /> : null}
      {artifact.error ? <Alert variant="warning" description={artifact.error} /> : null}
      {saved.lock ? (
        <View style={styles.card}>
          <Alert
            variant="warning"
            description="This artifact has a write lock. Age does not prove abandonment. Verify that ALL writers using this store have stopped before recovering it."
          />
          <Button variant="outline" disabled={disabled || !saved.lock.canRecover} onPress={recover}>
            Recover inspected empty lock
          </Button>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button variant="outline" size="sm" disabled={state.busy} onPress={reload}>
          Reload saved output
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} onPress={star}>
          {artifact.starred ? "Unstar" : "Star"}
        </Button>
        <Button variant="outline" size="sm" disabled={!saved.html} onPress={copy}>
          Copy HTML
        </Button>
        <Button variant="outline" size="sm" disabled={!saved.html} onPress={download}>
          Export HTML
        </Button>
        {artifact.source?.kind === "chat" && props.navigation ? (
          <Button variant="outline" size="sm" onPress={openSource}>
            Open source chat
          </Button>
        ) : null}
      </View>
      {feedback ? (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {feedback}
        </Text>
      ) : null}
      {artifact.source && artifact.source.kind !== "chat" ? (
        <Text style={styles.muted}>
          Source identifiers are retained. Open the owning Workflow or Schedule when that module is
          available.
        </Text>
      ) : null}
      {saved.html ? (
        <View style={styles.preview}>
          <ArtifactHtmlView key={state.epoch} html={saved.html} />
        </View>
      ) : (
        <Text style={styles.muted}>No safe preview is available.</Text>
      )}
      <DraftField draft={draft} field="name" label="Artifact name" />
      <DraftField draft={draft} field="description" label="Description" multiline />
      <Button
        variant="outline"
        disabled={disabled || artifact.status === "generating"}
        onPress={save}
      >
        Save details
      </Button>
      {artifact.hasData ? (
        <>
          <DraftField draft={draft} field="json" label="Artifact data (JSON)" multiline />
          <Button
            variant="outline"
            disabled={disabled || artifact.status === "generating"}
            onPress={data}
          >
            Update data only
          </Button>
        </>
      ) : (
        <Text style={styles.muted}>
          This artifact has no editable data contract. Regeneration can change its design.
        </Text>
      )}
      <DraftField draft={draft} field="instruction" label="Regeneration instructions" multiline />
      <ReviewModelPicker
        model={draft}
        hostId={props.reference.scope.hostId}
        active={props.active}
      />
      <ArtifactLifecycleActions
        artifact={artifact}
        disabled={disabled}
        actions={lifecycleActions}
      />
      <Text style={styles.title}>Recent runs</Text>
      {saved.runs.map((run) => (
        <Text
          key={run.id}
          style={styles.muted}
        >{`${run.trigger} · ${run.status} · ${run.startedAt}${run.error ? ` · ${run.error}` : ""}`}</Text>
      ))}
      <Text style={styles.title}>Generation log</Text>
      <Text selectable style={styles.muted}>
        {saved.transcript}
      </Text>
    </View>
  );
}
