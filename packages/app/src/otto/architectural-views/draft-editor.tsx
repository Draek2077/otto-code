import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import * as rpc from "@getpaseo/plugin/otto/architectural-views";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { SettingsExpander } from "@/otto/plugin-settings-ui";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useViewClient, unwrapView } from "./data";
import { ViewRequestError } from "./errors";
import { viewDraftModel, forgetViewDraft } from "./drafts";
import type { DraftDocument } from "./draft-model";
import { ViewPreview } from "./preview";
import { ViewTextField } from "./fields";
import { ViewAuthoringForm } from "./authoring-form";
import { styles } from "./styles";

export function ViewDraftEditor({
  document,
  scope,
  identity,
  active,
  workspaceId,
  workspaces,
  published,
  discarded,
  authoring = true,
}: {
  document: DraftDocument;
  scope: rpc.ViewScope;
  identity: rpc.ViewIdentity;
  active: boolean;
  workspaceId: string;
  workspaces: { value: string; label: string }[];
  published(view: rpc.ViewSummary): void;
  discarded(): void;
  authoring?: boolean;
}) {
  const client = useViewClient(scope.hostId),
    cache = useQueryClient();
  const draftId = document.draft.draftId;
  const selection = useMemo(() => ({ kind: "draft" as const, draftId }), [draftId]);
  const ports = useMemo(
    () => ({
      read: async () => {
        const result = unwrapView(await client.call(rpc.readView, { scope, identity, selection }));
        if (result.kind !== "draft") throw new Error("The selected draft is unavailable.");
        return result;
      },
      save: async (input: {
        expectedRevision: string;
        specification: rpc.ViewSpecification;
        title: string;
      }) =>
        unwrapView(await client.call(rpc.updateViewDraft, { ...input, scope, identity, draftId })),
      publish: async (expectedRevision: string, operationId: string) =>
        unwrapView(
          await client.call(rpc.publishViewDraft, {
            scope,
            identity,
            draftId,
            expectedRevision,
            operationId,
            userApproved: true,
          }),
        ),
      discard: async (expectedRevision: string, operationId: string) =>
        unwrapView(
          await client.call(rpc.discardViewDraft, {
            scope,
            identity,
            draftId,
            expectedRevision,
            operationId,
            userApproved: true,
          }),
        ),
      changed: () => {
        void cache.invalidateQueries({ queryKey: ["ottoViews", scope.hostId] });
      },
    }),
    [client, cache, scope, identity, draftId, selection],
  );
  const [model] = useState(() => viewDraftModel(cache, scope.hostId, identity, document, ports));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [inspection, setInspection] = useState<string | null>(null);
  useEffect(() => {
    model.setPorts(ports);
  }, [model, ports]);
  useEffect(() => {
    model.observe(document);
  }, [model, document]);
  useEffect(() => {
    if (active) return model.retain();
  }, [model, active]);
  const text = useCallback((value: string) => model.editText(value), [model]);
  const title = useCallback((value: string) => model.editTitle(value), [model]);
  const save = useCallback(() => {
    void model.save();
  }, [model]);
  const reload = useCallback(() => {
    void model.reload(() =>
      confirmDialog({
        title: "Reload saved draft?",
        message:
          "Replace local source edits with the current saved draft? This does not repeat any publication or chat creation.",
        confirmLabel: "Reload",
      }),
    );
  }, [model]);
  const publish = useCallback(async () => {
    const result = await model.publishView(() =>
      confirmDialog({
        title: "Publish this View?",
        message: "Publish the reviewed saved draft and retain the previous published revision?",
        confirmLabel: "Publish",
      }),
    );
    if (result) {
      forgetViewDraft(cache, model);
      published(result);
    }
  }, [cache, model, published]);
  const discard = useCallback(async () => {
    if (
      await model.discard(() =>
        confirmDialog({
          title: "Discard this draft?",
          message:
            "Remove this draft from the active library? Its source and history remain on the owning host. The authoring chat is kept.",
          confirmLabel: "Discard",
          destructive: true,
        }),
      )
    ) {
      forgetViewDraft(cache, model);
      discarded();
    }
  }, [cache, model, discarded]);
  const reviewBase = useCallback(() => {
    void model.metadata(async (expectedRevision, current) => {
      let base: string | null = null;
      try {
        const result = unwrapView(
          await client.call(rpc.readView, { scope, identity, selection: { kind: "published" } }),
        );
        if (result.kind !== "draft") base = result.view.revision;
      } catch (error) {
        if (!(error instanceof ViewRequestError && error.code === "not_found")) throw error;
      }
      if (
        !current() ||
        !(await confirmDialog({
          title: "Review the published base?",
          message: `Use ${base ? `published revision ${base.slice(0, 12)}` : "no published View"} as this draft's base? This does not merge or replace its source. Inspect the current View before approving.`,
          confirmLabel: "Use reviewed base",
        })) ||
        !current()
      )
        return null;
      return unwrapView(
        await client.call(rpc.rebaseViewDraft, {
          scope,
          identity,
          draftId,
          expectedRevision,
          expectedPublishedRevision: base,
          userApproved: true,
        }),
      );
    });
  }, [model, client, scope, identity, draftId]);
  const detach = useCallback(() => {
    void model.metadata(async (expectedRevision, current) => {
      if (
        !(await confirmDialog({
          title: "Detach authoring chat?",
          message:
            "Keep the old chat and revoke its draft-writing binding? You can then explicitly start a new chat.",
          confirmLabel: "Detach",
        })) ||
        !current()
      )
        return null;
      return unwrapView(
        await client.call(rpc.detachViewAuthoring, {
          scope,
          identity,
          draftId,
          expectedRevision,
          userApproved: true,
        }),
      );
    });
  }, [model, client, scope, identity, draftId]);
  const inspect = useCallback(async () => {
    if (!state.operationId || !active) return;
    try {
      const result = unwrapView(
        await client.call(rpc.inspectViewOperation, {
          scope,
          identity,
          draftId,
          operationId: state.operationId,
        }),
      );
      setInspection(
        `Observed operation outcome: ${result.outcome.replaceAll("_", " ")}. Reload explicitly before another write.`,
      );
      if (!state.dirty && result.outcome === "published" && result.publication)
        published(result.publication);
      if (!state.dirty && result.outcome === "discarded") discarded();
    } catch (error) {
      setInspection(error instanceof Error ? error.message : "Inspection failed.");
    }
  }, [
    client,
    scope,
    identity,
    draftId,
    state.operationId,
    state.dirty,
    active,
    published,
    discarded,
  ]);
  const accepted = useCallback(
    (draft: rpc.ViewDraft, expectedRevision: string) =>
      model.acceptMetadata(draft, expectedRevision),
    [model],
  );
  return (
    <View style={styles.page} testID="architectural-view-draft">
      <ScrollView style={draftStyles.header}>
        <View style={styles.content}>
          <Text style={styles.title}>{`${document.draft.title} · Draft`}</Text>
          {state.error ? <Alert variant="error" description={state.error} /> : null}
          {inspection ? <Alert description={inspection} /> : null}
          {state.peerChanged ? (
            <Alert
              variant="warning"
              description="The saved draft changed. Review its current source before another write; local edits are kept."
            />
          ) : null}
          {document.draft.starter ? (
            <Text style={styles.muted}>Staged starter. Author or edit it before publication.</Text>
          ) : null}
          <DraftButtons
            state={state}
            active={active}
            publish={publish}
            discard={discard}
            reload={reload}
            inspect={inspect}
          />
          <SourceActions
            state={state}
            active={active}
            title={title}
            text={text}
            save={save}
            reviewBase={reviewBase}
            detach={detach}
          />
          {authoring ? (
            <ViewAuthoringForm
              key={`${state.draft.revision}/${state.epoch}`}
              scope={scope}
              identity={identity}
              draft={state.draft}
              active={active}
              disabled={state.busy || state.blocked || state.dirty || state.peerChanged}
              workspaceId={workspaceId}
              workspaces={workspaces}
              accepted={accepted}
            />
          ) : null}
        </View>
      </ScrollView>
      <ViewPreview
        scope={scope}
        identity={identity}
        selection={selection}
        revision={document.draft.revision}
        active={active}
      />
    </View>
  );
}
const draftStyles = { header: { flexGrow: 0, maxHeight: "50%" as const } };

function DraftButtons({
  state,
  active,
  publish,
  discard,
  reload,
  inspect,
}: {
  state: ReturnType<import("./draft-model").ViewDraftModel["getSnapshot"]>;
  active: boolean;
  publish(): Promise<void>;
  discard(): Promise<void>;
  reload(): void;
  inspect(): Promise<void>;
}) {
  return (
    <View style={styles.row}>
      <Button
        size="sm"
        onPress={publish}
        disabled={
          !active ||
          state.busy ||
          state.blocked ||
          state.dirty ||
          state.peerChanged ||
          state.draft.starter
        }
      >
        Publish
      </Button>
      <Button
        size="sm"
        variant="outline"
        onPress={discard}
        disabled={!active || state.busy || state.blocked}
      >
        Discard
      </Button>
      <Button size="sm" variant="outline" onPress={reload} disabled={!active || state.busy}>
        Review saved draft
      </Button>
      {state.operationId ? (
        <Button size="sm" variant="outline" onPress={inspect} disabled={!active || state.busy}>
          Inspect operation
        </Button>
      ) : null}
    </View>
  );
}
function SourceActions({
  state,
  active,
  title,
  text,
  save,
  reviewBase,
  detach,
}: {
  state: ReturnType<import("./draft-model").ViewDraftModel["getSnapshot"]>;
  active: boolean;
  title(value: string): void;
  text(value: string): void;
  save(): void;
  reviewBase(): void;
  detach(): void;
}) {
  return (
    <SettingsExpander label="Source and draft actions">
      <View style={styles.content}>
        <ViewTextField label="Title" value={state.title} change={title} epoch={state.epoch} />
        <ViewTextField
          label="JSON specification"
          value={state.text}
          change={text}
          multiline
          epoch={state.epoch}
        />
        <View style={styles.row}>
          <Button onPress={save} disabled={!active || state.busy || state.blocked || !state.dirty}>
            Validate and save source
          </Button>
          <Button
            variant="outline"
            onPress={reviewBase}
            disabled={!active || state.busy || state.blocked}
          >
            Review published base
          </Button>
          {state.draft.authoringAgentId ? (
            <Button
              variant="outline"
              onPress={detach}
              disabled={!active || state.busy || state.blocked}
            >
              Detach authoring chat
            </Button>
          ) : null}
        </View>
      </View>
    </SettingsExpander>
  );
}
