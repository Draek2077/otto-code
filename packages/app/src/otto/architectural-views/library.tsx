import { Children, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { ViewDraft, ViewScope, ViewSummary } from "@getpaseo/plugin/otto/architectural-views";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { Alert } from "@/components/ui/alert";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useViewLibrary } from "./data";
import { ViewChangeLease } from "./changes";
import { ViewDetail, type ViewTarget } from "./reader";
import { CreateView } from "./create";
import type { ViewDestination } from "./navigation";
import { recoverableViewDrafts } from "./drafts";
import { styles } from "./styles";
function targetFor(item: ViewDraft | ViewSummary): ViewTarget {
  return {
    identity: { viewId: item.viewId, origin: item.origin },
    selection: "draftId" in item ? { kind: "draft", draftId: item.draftId } : { kind: "published" },
  };
}
function LibraryRow({
  item,
  selected,
  select,
}: {
  item: ViewDraft | ViewSummary;
  selected: boolean;
  select(target: ViewTarget): void;
}) {
  const press = useCallback(() => select(targetFor(item)), [select, item]);
  return (
    <View style={styles.card}>
      <Button variant={selected ? "secondary" : "ghost"} onPress={press} size="sm">
        {item.title}
      </Button>
      <Text
        style={styles.muted}
      >{`${item.diagramType} · ${"draftId" in item ? "Draft" : "Published"} · ${item.origin.location}`}</Text>
      {item.sourceStatus !== "current" ? (
        <Text style={styles.muted}>{`Source ${item.sourceStatus}`}</Text>
      ) : null}
    </View>
  );
}
export function ViewLibrary({
  scope,
  active,
  workspaceId,
  workspaces,
  destination,
}: {
  scope: ViewScope;
  active: boolean;
  workspaceId: string;
  workspaces: { value: string; label: string }[];
  destination?: ViewDestination;
}) {
  const cache = useQueryClient(),
    compact = useIsCompactFormFactor();
  const [selected, setSelected] = useState<ViewTarget | null>(
    destination?.identity
      ? {
          identity: destination.identity,
          selection: destination.selection ?? { kind: "published" },
        }
      : null,
  );
  const [creating, setCreating] = useState(false),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0);
  const input = useRef<EditingTextInputHandle | null>(null);
  useEffect(() => {
    if (!destination) return;
    setSelected(
      destination.identity
        ? {
            identity: destination.identity,
            selection: destination.selection ?? { kind: "published" },
          }
        : null,
    );
    setCreating(false);
  }, [destination]);
  const library = useViewLibrary(scope, active, destination?.reference, offset, query);
  const select = useCallback((target: ViewTarget) => {
    setCreating(false);
    setSelected(target);
  }, []);
  const close = useCallback(() => {
    setCreating(false);
    setSelected(null);
  }, []);
  const create = useCallback(() => {
    setCreating(true);
    setSelected(null);
  }, []);
  const created = useCallback(
    (draft: ViewDraft) => {
      setCreating(false);
      setSelected(targetFor(draft));
      void cache.invalidateQueries({ queryKey: ["ottoViews", scope.hostId] });
    },
    [cache, scope.hostId],
  );
  const refresh = useCallback(() => {
    void cache.invalidateQueries({ queryKey: ["ottoViews", scope.hostId] });
  }, [cache, scope.hostId]);
  const search = useCallback((value: string) => {
    setQuery(value);
    setOffset(0);
  }, []);
  const clear = useCallback(() => {
    input.current?.replaceText("");
    search("");
  }, [search]);
  const previous = useCallback(() => setOffset((value) => Math.max(0, value - 100)), []);
  const next = useCallback(() => {
    if (library.data?.nextOffset !== null && library.data?.nextOffset !== undefined)
      setOffset(library.data.nextOffset);
  }, [library.data]);
  const items = useMemo(
    () => [...(library.data?.views ?? []), ...(library.data?.drafts ?? [])],
    [library.data],
  );
  const recovery = recoverableViewDrafts(cache, scope.hostId, library.data?.origins ?? []).filter(
    (draft) =>
      !library.data?.drafts.some(
        (saved) =>
          saved.draftId === draft.draftId && saved.origin.storeKey === draft.origin.storeKey,
      ),
  );
  const rows = (
    <LibraryResults
      library={library}
      items={items}
      recovery={recovery}
      selected={selected}
      select={select}
      offset={offset}
      previous={previous}
      next={next}
    />
  );
  const detail = (
    <LibraryDetail
      creating={creating}
      scope={scope}
      destination={destination}
      active={active}
      created={created}
      close={close}
      selected={selected}
      workspaceId={workspaceId}
      workspaces={workspaces}
      select={select}
    />
  );
  return (
    <View style={styles.page} testID="architectural-view-library">
      <View style={styles.toolbar}>
        <View style={styles.row}>
          <View style={styles.spacer}>
            <FormTextInput
              ref={input}
              initialValue=""
              onChangeText={search}
              accessibilityLabel="Search Views"
              placeholder="Search Views"
              size={compact ? "md" : "sm"}
            />
          </View>
          <Button size="sm" variant="ghost" onPress={clear} disabled={!query}>
            Clear
          </Button>
          <Button
            size="sm"
            variant="outline"
            onPress={refresh}
            disabled={!active || library.isFetching}
          >
            Refresh
          </Button>
          <Button size="sm" onPress={create} disabled={!active}>
            New View
          </Button>
          {compact && (selected || creating) ? (
            <Button size="sm" variant="outline" onPress={close}>
              Views
            </Button>
          ) : null}
        </View>
        {destination?.reference ? (
          <Text
            style={styles.muted}
          >{`Linked to ${destination.reference.kind}: ${destination.reference.id}`}</Text>
        ) : null}
        {library.data?.origins.map((origin) => (
          <ViewChangeLease
            key={origin.storeKey}
            hostId={scope.hostId}
            projectId={library.data.projectId}
            origin={origin}
            active={active}
          />
        ))}
      </View>
      <LibraryLayout compact={compact} detailOpen={!!selected || creating}>
        {rows}
        {detail}
      </LibraryLayout>
    </View>
  );
}

function LibraryResults({
  library,
  items,
  recovery,
  selected,
  select,
  offset,
  previous,
  next,
}: {
  library: ReturnType<typeof useViewLibrary>;
  items: Array<ViewDraft | ViewSummary>;
  recovery: ViewDraft[];
  selected: ViewTarget | null;
  select(target: ViewTarget): void;
  offset: number;
  previous(): void;
  next(): void;
}) {
  return (
    <View style={styles.content}>
      {library.error ? <Alert variant="error" description={library.error.message} /> : null}
      {!library.data && !library.error ? <Text style={styles.muted}>Loading Views...</Text> : null}
      {library.data?.diagnostics.map((issue) => (
        <Alert
          key={`${issue.origin.storeKey}/${issue.viewId}`}
          variant="warning"
          description={`${issue.viewId}: ${issue.message}`}
        />
      ))}
      {recovery.length ? (
        <Text style={styles.muted}>Retained local drafts (copy or recover your edits)</Text>
      ) : null}
      {recovery.map((item) => (
        <LibraryRow
          key={`recovery/${item.origin.storeKey}/${item.draftId}`}
          item={item}
          selected={false}
          select={select}
        />
      ))}
      {items.map((item) => (
        <LibraryRow
          key={JSON.stringify(targetFor(item))}
          item={item}
          selected={!!selected && JSON.stringify(selected) === JSON.stringify(targetFor(item))}
          select={select}
        />
      ))}
      {library.data && !items.length ? (
        <Text style={styles.muted}>No Views match this selection.</Text>
      ) : null}
      {library.data?.diagnosticsOmitted ? (
        <Text
          style={styles.muted}
        >{`${library.data.diagnosticsOmitted} additional diagnostics remain on the owning host.`}</Text>
      ) : null}
      <View style={styles.row}>
        <Button variant="outline" size="sm" onPress={previous} disabled={!offset}>
          Previous
        </Button>
        <Button variant="outline" size="sm" onPress={next} disabled={!library.data?.nextOffset}>
          Next
        </Button>
      </View>
    </View>
  );
}
function LibraryDetail({
  creating,
  scope,
  destination,
  active,
  created,
  close,
  selected,
  workspaceId,
  workspaces,
  select,
}: {
  creating: boolean;
  scope: ViewScope;
  destination?: ViewDestination;
  active: boolean;
  created(draft: ViewDraft): void;
  close(): void;
  selected: ViewTarget | null;
  workspaceId: string;
  workspaces: { value: string; label: string }[];
  select(target: ViewTarget): void;
}) {
  if (creating)
    return (
      <ScrollView>
        <View style={styles.content}>
          <CreateView
            scope={scope}
            reference={destination?.reference}
            active={active}
            created={created}
            close={close}
          />
        </View>
      </ScrollView>
    );
  if (selected)
    return (
      <ViewDetail
        key={JSON.stringify(selected)}
        scope={scope}
        target={selected}
        active={active}
        workspaceId={workspaceId}
        workspaces={workspaces}
        select={select}
        closed={close}
      />
    );
  return (
    <View style={styles.content}>
      <Text style={styles.muted}>Choose a View or create a draft from Knowledge.</Text>
    </View>
  );
}
function LibraryLayout({
  compact,
  detailOpen,
  children,
}: {
  compact: boolean;
  detailOpen: boolean;
  children: ReactNode;
}) {
  const [rows, detail] = Children.toArray(children);
  if (compact) return detailOpen ? detail : <ScrollView>{rows}</ScrollView>;
  return (
    <View style={styles.columns}>
      <ScrollView style={styles.list} testID="architectural-view-list">
        {rows}
      </ScrollView>
      <View style={styles.page}>{detail}</View>
    </View>
  );
}
