import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import * as rpc from "@getpaseo/plugin/otto/architectural-views";
import { useFetchQuery } from "@/data/query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsExpander } from "@/otto/plugin-settings-ui";
import { confirmDialog } from "@/utils/confirm-dialog";
import { ViewDraftEditor } from "./draft-editor";
import { ViewPreview } from "./preview";
import { findViewDraftModel } from "./drafts";
import { LocalViewDraftRecovery } from "./draft-recovery";
import { useViewClient, useViewDocument, unwrapView } from "./data";
import { styles } from "./styles";
export interface ViewTarget {
  identity: rpc.ViewIdentity;
  selection: rpc.ViewSelection;
}
function RevisionItem({
  summary,
  select,
}: {
  summary: rpc.ViewSummary;
  select(summary: rpc.ViewSummary): void;
}) {
  const press = useCallback(() => select(summary), [select, summary]);
  return (
    <Button
      variant="ghost"
      size="sm"
      onPress={press}
    >{`${summary.renderedAt} · ${summary.revision.slice(0, 12)}`}</Button>
  );
}
function ViewHistory({
  scope,
  identity,
  active,
  select,
}: {
  scope: rpc.ViewScope;
  identity: rpc.ViewIdentity;
  active: boolean;
  select(target: ViewTarget): void;
}) {
  const client = useViewClient(scope.hostId),
    [offset, setOffset] = useState(0);
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 2000,
    queryKey: [
      "ottoViews",
      scope.hostId,
      scope.target.kind,
      scope.target.id,
      "history",
      identity,
      offset,
    ],
    enabled: active,
    retry: false,
    queryFn: async () =>
      unwrapView(await client.call(rpc.listViewRevisions, { scope, identity, offset })),
  });
  const open = useCallback(
    (summary: rpc.ViewSummary) =>
      select({ identity, selection: { kind: "revision", revisionId: summary.revision } }),
    [identity, select],
  );
  const previous = useCallback(() => setOffset((value) => Math.max(0, value - 50)), []);
  const next = useCallback(() => {
    if (query.data?.nextOffset !== null && query.data?.nextOffset !== undefined)
      setOffset(query.data.nextOffset);
  }, [query.data]);
  return (
    <View style={styles.content}>
      {query.error ? <Alert variant="error" description={query.error.message} /> : null}
      {query.data?.revisions.map((summary) => (
        <RevisionItem key={summary.revision} summary={summary} select={open} />
      ))}
      {query.data?.revisions.length === 0 ? (
        <Text style={styles.muted}>No previous revisions.</Text>
      ) : null}
      <View style={styles.row}>
        <Button variant="outline" size="sm" onPress={previous} disabled={!offset}>
          Previous revisions
        </Button>
        <Button variant="outline" size="sm" onPress={next} disabled={!query.data?.nextOffset}>
          Next revisions
        </Button>
      </View>
    </View>
  );
}
function PublishedView({
  document,
  scope,
  identity,
  active,
  select,
  closed,
}: {
  document: Exclude<rpc.ViewDocument, { kind: "draft" }>;
  scope: rpc.ViewScope;
  identity: rpc.ViewIdentity;
  active: boolean;
  select(target: ViewTarget): void;
  closed(): void;
}) {
  const client = useViewClient(scope.hostId),
    cache = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [blocked, setBlocked] = useState(false);
  const latch = useRef(false),
    lifetime = useRef({ active: false });
  useEffect(() => {
    const owner = { active };
    lifetime.current = owner;
    return () => {
      owner.active = false;
    };
  }, [active]);
  const mutate = useCallback(
    async (action: (current: () => boolean) => Promise<void>) => {
      const owner = lifetime.current;
      if (!owner.active || latch.current || blocked) return;
      const current = () => owner.active && owner === lifetime.current;
      latch.current = true;
      setBusy(true);
      setError(null);
      try {
        await action(current);
      } catch (failure) {
        if (current())
          setError(
            failure instanceof Error
              ? failure.message
              : "The View action was not acknowledged. Inspect the current library before another write.",
          );
        setBlocked(true);
      } finally {
        if (!current()) {
          setBlocked(true);
          setError(
            "A hidden action may have changed this View. Inspect its library before another write.",
          );
        }
        latch.current = false;
        setBusy(false);
      }
    },
    [blocked],
  );
  const update = useCallback(() => {
    void mutate(async (current) => {
      const draft = unwrapView(
        await client.call(rpc.createViewDraft, {
          scope,
          viewId: identity.viewId,
          draftId: `draft-${globalThis.crypto.randomUUID()}`,
          operationId: globalThis.crypto.randomUUID(),
          title: document.view.title,
          diagramType: document.view.diagramType,
          knowledgeReferences: document.view.knowledgeReferences,
          published: { ...identity, revision: document.view.revision },
        }),
      );
      void cache.invalidateQueries({ queryKey: ["ottoViews", scope.hostId] });
      if (current()) select({ identity, selection: { kind: "draft", draftId: draft.draftId } });
    });
  }, [mutate, client, scope, identity, document.view, cache, select]);
  const remove = useCallback(() => {
    void mutate(async (current) => {
      if (
        !(await confirmDialog({
          title: "Remove this View?",
          message: "Remove it from the active library while retaining its source and revisions?",
          confirmLabel: "Remove",
          destructive: true,
        })) ||
        !current()
      )
        return;
      unwrapView(
        await client.call(rpc.removeView, {
          scope,
          identity,
          expectedRevision: document.view.revision,
          operationId: globalThis.crypto.randomUUID(),
          userApproved: true,
        }),
      );
      void cache.invalidateQueries({ queryKey: ["ottoViews", scope.hostId] });
      if (current()) closed();
    });
  }, [mutate, client, scope, identity, document.view.revision, cache, closed]);
  const selection = useMemo<rpc.ViewSelection>(
    () =>
      document.kind === "revision"
        ? { kind: "revision", revisionId: document.view.revision }
        : { kind: "published" },
    [document.kind, document.view.revision],
  );
  return (
    <View style={styles.page}>
      <ScrollView style={readerStyles.header}>
        <View style={styles.content}>
          <Text style={styles.title}>{document.view.title}</Text>
          <Text
            style={styles.muted}
          >{`${document.view.diagramType} · ${document.kind === "revision" ? "Previous revision" : document.view.origin.location}`}</Text>
          {document.view.sourceStatus !== "current" ? (
            <Alert
              variant="warning"
              description={
                document.view.sourceStatus === "stale"
                  ? "Linked Knowledge changed after this specification was saved."
                  : "Source freshness is unknown."
              }
            />
          ) : null}
          {error ? <Alert variant="error" description={error} /> : null}
          {document.kind === "published" && document.view.state === "published" ? (
            <View style={styles.row}>
              <Button onPress={update} disabled={!active || busy || blocked}>
                Update View
              </Button>
              <Button variant="outline" onPress={remove} disabled={!active || busy || blocked}>
                Remove
              </Button>
            </View>
          ) : null}
          <SettingsExpander label="Revisions">
            <ViewHistory scope={scope} identity={identity} active={active} select={select} />
          </SettingsExpander>
        </View>
      </ScrollView>
      <ViewPreview
        scope={scope}
        identity={identity}
        selection={selection}
        revision={document.view.revision}
        active={active}
      />
    </View>
  );
}
export function ViewDetail({
  scope,
  target,
  active,
  workspaceId,
  workspaces,
  select,
  closed,
  authoring = true,
}: {
  scope: rpc.ViewScope;
  target: ViewTarget;
  active: boolean;
  workspaceId: string;
  workspaces: { value: string; label: string }[];
  select(target: ViewTarget): void;
  closed(): void;
  authoring?: boolean;
}) {
  const query = useViewDocument(scope, target.identity, target.selection, active);
  const cache = useQueryClient();
  const localDraft =
    target.selection.kind === "draft"
      ? findViewDraftModel(cache, scope.hostId, target.identity, target.selection.draftId)
      : undefined;
  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);
  const published = useCallback(
    (summary: rpc.ViewSummary) =>
      select({
        identity: { viewId: summary.viewId, origin: summary.origin },
        selection: { kind: "published" },
      }),
    [select],
  );
  if (query.error && localDraft)
    return <LocalViewDraftRecovery model={localDraft} active={active} close={closed} />;
  if (query.error)
    return (
      <View style={styles.content}>
        <Alert variant="error" description={query.error.message} />
        <Button variant="outline" onPress={refresh} disabled={!active || query.isFetching}>
          Read current selection
        </Button>
      </View>
    );
  if (!query.data)
    return (
      <View style={styles.content}>
        <Text style={styles.muted}>Loading View...</Text>
      </View>
    );
  if (query.data.kind === "draft")
    return (
      <ViewDraftEditor
        key={JSON.stringify([target.identity, query.data.draft.draftId])}
        document={query.data}
        scope={scope}
        identity={target.identity}
        active={active}
        workspaceId={workspaceId}
        workspaces={workspaces}
        published={published}
        discarded={closed}
        authoring={authoring}
      />
    );
  return (
    <PublishedView
      key={JSON.stringify(target)}
      document={query.data}
      scope={scope}
      identity={target.identity}
      active={active}
      select={select}
      closed={closed}
    />
  );
}
const readerStyles = { header: { flexGrow: 0, maxHeight: "40%" as const } };
