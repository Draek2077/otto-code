import { useCallback, useMemo, useRef } from "react";
import { View } from "react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@/components/settings";
import type { SettingsInputHandle } from "@getpaseo/plugin/client/ui";
import type { KnowledgeCatalog } from "@getpaseo/plugin/otto/project-knowledge";
import { Button } from "@/components/ui/button";
import type { KnowledgeSelection } from "./document";
import { styles } from "./styles";
type Summary = KnowledgeCatalog["records"][number];
function PageRow({
  page,
  onSelect,
}: {
  page: Summary;
  onSelect(selection: KnowledgeSelection): void;
}) {
  const open = useCallback(
    () => onSelect({ type: "page", id: page.id, kind: page.kind }),
    [onSelect, page.id, page.kind],
  );
  const status = { proposed: "Draft", confirmed: "Confirmed", superseded: "History" }[page.status];
  return (
    <SettingsAction
      label={page.title}
      testID={`knowledge-record-${page.id}`}
      hint={`${page.kind} · ${status}`}
      actionLabel="Open"
      onPress={open}
    />
  );
}
function RootRow({
  slug,
  onSelect,
}: {
  slug: KnowledgeCatalog["roots"][number]["slug"];
  onSelect(selection: KnowledgeSelection): void;
}) {
  const open = useCallback(() => onSelect({ type: "root", slug }), [slug, onSelect]);
  return (
    <SettingsAction
      label={`${slug[0].toUpperCase()}${slug.slice(1)}`}
      testID={`knowledge-root-${slug}`}
      actionLabel="Open"
      onPress={open}
    />
  );
}
export function KnowledgeCatalogView({
  catalog,
  query,
  inactive,
  offset,
  setQuery,
  setInactive,
  setOffset,
  onSelect,
}: {
  catalog: KnowledgeCatalog;
  query: string;
  inactive: boolean;
  offset: number;
  setQuery(value: string): void;
  setInactive(value: boolean): void;
  setOffset(value: number): void;
  onSelect(selection: KnowledgeSelection): void;
}) {
  const search = useRef<SettingsInputHandle>(null);
  const clear = useCallback(() => {
    search.current?.replaceText("");
    setQuery("");
  }, [setQuery]);
  const next = useCallback(() => {
    if (catalog.nextOffset !== null) setOffset(catalog.nextOffset);
  }, [catalog.nextOffset, setOffset]);
  const previous = useCallback(() => setOffset(Math.max(0, offset - 50)), [offset, setOffset]);
  const roots = useMemo(
    () =>
      catalog.roots.map((root) => <RootRow key={root.slug} slug={root.slug} onSelect={onSelect} />),
    [catalog.roots, onSelect],
  );
  const pages = useMemo(
    () => catalog.records.map((page) => <PageRow key={page.id} page={page} onSelect={onSelect} />),
    [catalog.records, onSelect],
  );
  return (
    <>
      <SettingsSection title="Project map">
        <SettingsCard>{roots}</SettingsCard>
      </SettingsSection>
      <SettingsSection title="Knowledge pages">
        <SettingsCard>
          <SettingsInput
            ref={search}
            label="Search titles and tags"
            initialValue={query}
            onChangeText={setQuery}
          />
          <SettingsRow label="Search">
            <Button variant="outline" size="sm" onPress={clear} disabled={!query}>
              Clear
            </Button>
          </SettingsRow>
          <SettingsSwitch
            label="Include Draft and History"
            value={inactive}
            onValueChange={setInactive}
          />
        </SettingsCard>
        {pages.length ? (
          <SettingsCard>{pages}</SettingsCard>
        ) : (
          <SettingsRow label="No matching Knowledge pages." />
        )}
        <View style={styles.actions}>
          <Button variant="outline" size="sm" onPress={previous} disabled={!offset}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onPress={next} disabled={catalog.nextOffset === null}>
            Next
          </Button>
        </View>
      </SettingsSection>
    </>
  );
}
