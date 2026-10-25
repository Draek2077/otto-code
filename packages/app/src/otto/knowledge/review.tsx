import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import {
  mutateKnowledge,
  proposeKnowledgeRefinement,
  type KnowledgeScope,
  type KnowledgeRefinementTarget,
} from "@getpaseo/plugin/otto/project-knowledge";
import { useHostFeature } from "@/runtime/host-features";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SettingsCard, SettingsSelect } from "@/components/settings";
import { DiffViewer } from "@/components/diff-viewer";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  KnowledgeReviewModel,
  KnowledgeReviewPortError,
  type ReviewSelection,
} from "./review-model";
import { KnowledgeReviewSurface } from "./review-surface";
import { knowledgeReviewsFor } from "./review-owner";
import { styles } from "./styles";
import { ReviewModelPicker } from "./review-model-picker";

const kinds = [
  { value: "replace", label: "Replace" },
  { value: "refine", label: "Refine" },
];
interface EditingNote {
  selection: ReviewSelection;
  kind: "replace" | "refine";
  value: string;
  id?: string;
}
function NoteForm({
  note,
  model,
  close,
}: {
  note: EditingNote;
  model: KnowledgeReviewModel;
  close(): void;
}) {
  const [kind, setKind] = useState(note.kind);
  const [value, setValue] = useState(note.value);
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const changeKind = useCallback((next: string) => {
    if (next === "replace" || next === "refine") setKind(next);
  }, []);
  const save = useCallback(() => {
    if (model.note(note.selection, kind, value, note.id)) close();
  }, [model, note, kind, value, close]);
  return (
    <SettingsCard>
      <Text selectable>{note.selection.selectedText}</Text>
      <SettingsSelect label="Review note" value={kind} options={kinds} onValueChange={changeKind} />
      <Field label={kind === "replace" ? "Exact replacement" : "Refinement instruction"}>
        <FormTextInput
          initialValue={value}
          onChangeText={setValue}
          multiline
          size={size}
          testID="knowledge-review-note-value"
        />
      </Field>
      <View style={styles.actions}>
        <Button onPress={close} variant="outline">
          Cancel note
        </Button>
        <Button onPress={save} disabled={kind === "refine" && !value.trim()}>
          Save note
        </Button>
      </View>
    </SettingsCard>
  );
}
function Hunk({
  hunk,
  model,
  kept,
}: {
  hunk: NonNullable<ReturnType<KnowledgeReviewModel["getSnapshot"]>["diff"]>["hunks"][number];
  model: KnowledgeReviewModel;
  kept: boolean;
}) {
  const toggle = useCallback(() => model.toggle(hunk.id), [model, hunk.id]);
  return (
    <SettingsCard>
      <Button
        onPress={toggle}
        variant={kept ? "secondary" : "outline"}
        accessibilityLabel={`${kept ? "Drop" : "Keep"} change ${hunk.id}`}
        size="sm"
      >
        {kept ? "Kept change" : "Dropped change"}
      </Button>
      <DiffViewer diffLines={hunk.lines} />
    </SettingsCard>
  );
}
function ReviewNote({
  note,
  model,
  edit,
}: {
  note: ReturnType<KnowledgeReviewModel["getSnapshot"]>["notes"][number];
  model: KnowledgeReviewModel;
  edit(id: string): void;
}) {
  const open = useCallback(() => edit(note.id), [edit, note.id]);
  const remove = useCallback(() => model.remove(note.id), [model, note.id]);
  return (
    <SettingsCard>
      <Text selectable>
        {note.kind === "replace" ? "Replace" : "Refine"}: {note.selectedText}
      </Text>
      <Text selectable>{note.value || "Remove selected text"}</Text>
      <View style={styles.actions}>
        <Button onPress={open} variant="outline" size="sm">
          Edit note
        </Button>
        <Button onPress={remove} variant="outline" size="sm">
          Remove note
        </Button>
      </View>
    </SettingsCard>
  );
}
function ReviewBody({
  model,
  scope,
  active,
  discard,
}: {
  model: KnowledgeReviewModel;
  scope: KnowledgeScope;
  active: boolean;
  discard(): void;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  const surfaceActive = active && retained && visible;
  const [editing, setEditing] = useState<EditingNote | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const size = useIsCompactFormFactor() ? "md" : "sm";
  useEffect(() => {
    if (surfaceActive) return model.activate();
  }, [model, surfaceActive]);
  const close = useCallback(() => setEditing(null), []);
  const select = useCallback((selection: ReviewSelection | null, kind: "replace" | "refine") => {
    if (!selection) {
      setSelectionError(
        "This selection cannot be mapped to unambiguous Markdown. Select a source-backed passage or use Edit truth.",
      );
      return;
    }
    setSelectionError("");
    setEditing({ selection, kind, value: kind === "replace" ? selection.selectedText : "" });
  }, []);
  const edit = useCallback(
    (id: string) => {
      const note = model.getSnapshot().notes.find((item) => item.id === id);
      if (note) setEditing({ selection: note, kind: note.kind, value: note.value, id });
    },
    [model],
  );
  const generate = useCallback(() => {
    close();
    void model.generate();
  }, [model, close]);
  const annotate = useCallback(() => model.reviewAcceptedResult(), [model]);
  const reason = useCallback((value: string) => model.reason(value), [model]);
  const apply = useCallback(() => {
    void model.apply(() =>
      confirmDialog({
        title: "Apply kept Knowledge changes?",
        message:
          "Only the kept article changes will be saved. A confirmed record returns to Draft and requires human confirmation before agents reuse it. Root pages retain their existing lifecycle.",
        confirmLabel: "Apply kept changes",
      }),
    );
  }, [model]);
  const cancel = useCallback(async () => {
    if (
      await confirmDialog({
        title: "Discard this Knowledge review?",
        message: "Its local notes and proposal will be discarded. Saved Knowledge stays unchanged.",
        confirmLabel: "Discard review",
        destructive: true,
      })
    )
      discard();
  }, [discard]);
  const noteEditor = useMemo(
    () =>
      editing ? (
        <NoteForm
          key={JSON.stringify([editing.selection.start, editing.selection.end, editing.id])}
          note={editing}
          model={model}
          close={close}
        />
      ) : null,
    [editing, model, close],
  );
  return (
    <View testID="knowledge-review" style={styles.contentGap}>
      {state.error || selectionError ? (
        <Alert variant="error" description={state.error || selectionError} />
      ) : null}
      <View style={styles.actions}>
        <Button onPress={cancel} disabled={state.busy} variant="outline">
          Discard review
        </Button>
        {state.diff ? (
          <Button onPress={annotate} disabled={state.busy || state.blocked} variant="outline">
            Refine kept result
          </Button>
        ) : (
          <Button
            onPress={generate}
            disabled={state.busy || state.blocked || !state.notes.length || Boolean(editing)}
          >
            {state.busy ? "Generating proposal..." : "Generate proposal"}
          </Button>
        )}
      </View>
      {state.diff ? (
        <>
          <Text>
            Review changes against the original saved article. Nothing is written until you apply.
          </Text>
          {state.diff.hunks.map((hunk) => (
            <Hunk key={hunk.id} hunk={hunk} model={model} kept={state.kept.has(hunk.id)} />
          ))}
          {!state.diff.hunks.length ? <Text>The proposal contains no changes.</Text> : null}
          <Field label="Reason">
            <FormTextInput
              initialValue={state.reason}
              onChangeText={reason}
              size={size}
              testID="knowledge-review-reason"
            />
          </Field>
          <Button
            onPress={apply}
            disabled={state.busy || state.blocked || !state.kept.size || !state.reason.trim()}
          >
            Apply kept changes
          </Button>
        </>
      ) : (
        <>
          <ReviewModelPicker model={model} hostId={scope.hostId} active={surfaceActive} />
          <KnowledgeReviewSurface
            body={state.body}
            hostId={scope.hostId}
            notes={state.notes}
            onSelection={select}
            onEditNote={edit}
            editor={surfaceActive ? noteEditor : null}
            onCloseEditor={close}
          />
          {state.notes.map((note) => (
            <ReviewNote key={note.id} note={note} model={model} edit={edit} />
          ))}
        </>
      )}
    </View>
  );
}
export function KnowledgeArticleReview({
  scope,
  target,
  body,
  active,
}: {
  scope: KnowledgeScope;
  target: KnowledgeRefinementTarget;
  body: string;
  active: boolean;
}) {
  // COMPAT(ottoKnowledgeRefinement): added v0.10.0; remove after 2027-04-25 when host floor >= v0.10.0.
  const available = useHostFeature(scope.hostId, "ottoKnowledgeRefinement");
  const installation = usePaseo();
  const owner = useMemo(() => knowledgeReviewsFor(installation), [installation]);
  const readReview = useCallback(() => owner.get(scope, target) ?? null, [owner, scope, target]);
  const model = useSyncExternalStore(owner.subscribe, readReview);
  const propose = useRpc(proposeKnowledgeRefinement);
  const mutate = useRpc(mutateKnowledge);
  const cache = useQueryClient();
  const [error, setError] = useState("");
  const open = useCallback(() => {
    try {
      owner.open(scope, target, body, {
        propose: async (input) => {
          const result = await propose({ scope, target, ...input });
          if (!result.ok)
            throw new KnowledgeReviewPortError(result.error.code, result.error.message);
          return result.value;
        },
        apply: async (statement, reason) => {
          const command =
            target.type === "page"
              ? {
                  action: "truth" as const,
                  kind: target.kind,
                  id: target.id,
                  expectedRevision: target.revision,
                  statement,
                  reason,
                }
              : {
                  action: "root" as const,
                  slug: target.slug,
                  expectedRevision: target.revision,
                  body: statement,
                };
          const result = await mutate({ scope, command });
          if (!result.ok) throw new Error(result.error.message);
          await cache.invalidateQueries({ queryKey: ["ottoKnowledge", scope.hostId] });
        },
      });
    } catch {
      setError("Finish or discard an existing Knowledge review before opening another.");
    }
  }, [owner, scope, target, body, propose, mutate, cache]);
  const discard = useCallback(() => {
    if (model) owner.discard(scope, model);
  }, [owner, scope, model]);
  useEffect(() => {
    model?.peerRevision(target.revision);
  }, [model, target.revision]);
  useEffect(() => {
    if (!model) return;
    return model.subscribe(() => {
      if (model.getSnapshot().applied) owner.discard(scope, model);
    });
  }, [model, owner, scope]);
  if (!available)
    return (
      <>
        <MarkdownRenderer text={body} serverId={scope.hostId} />
        <Alert description="Update the host to review Knowledge with AI." />
      </>
    );
  if (!model)
    return (
      <View style={styles.contentGap}>
        {error ? <Alert variant="error" description={error} /> : null}
        <Button
          onPress={open}
          disabled={!body.trim() || body.length > 80000}
          variant="outline"
          size="sm"
        >
          Review article
        </Button>
        <MarkdownRenderer text={body} serverId={scope.hostId} />
      </View>
    );
  return <ReviewBody model={model} scope={scope} active={active} discard={discard} />;
}
