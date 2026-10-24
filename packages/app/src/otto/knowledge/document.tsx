import { useCallback, useEffect } from "react";
import { View } from "react-native";
import { useFetchQuery } from "@/data/query";
import { useRpc } from "@getpaseo/plugin/client";
import {
  readKnowledgePage,
  readKnowledgeRoot,
  type KnowledgeRecord,
  type KnowledgeScope,
} from "@getpaseo/plugin/otto/project-knowledge";
import { SettingsSection, SettingsRow } from "@/components/settings";
import { SettingsExpander } from "@/otto/plugin-settings-ui";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import type { EditorSeed } from "./editor-model";
import { styles } from "./styles";

export type KnowledgeSelection =
  | { type: "page"; kind: KnowledgeRecord["kind"]; id: string }
  | { type: "root"; slug: NonNullable<EditorSeed["root"]>["slug"] };
function PageActions({ page, onEdit }: { page: KnowledgeRecord; onEdit(seed: EditorSeed): void }) {
  const truth = useCallback(() => onEdit({ page, action: "truth" }), [page, onEdit]);
  const describe = useCallback(() => onEdit({ page, action: "describe" }), [page, onEdit]);
  const evidence = useCallback(() => onEdit({ page, action: "evidence" }), [page, onEdit]);
  const review = useCallback(() => onEdit({ page, action: "review" }), [page, onEdit]);
  const delivery = useCallback(() => onEdit({ page, action: "delivery" }), [page, onEdit]);
  const reference = useCallback(() => onEdit({ page, action: "reference" }), [page, onEdit]);
  const purge = useCallback(() => onEdit({ page, action: "purge" }), [page, onEdit]);
  return (
    <View style={styles.actions}>
      <Button onPress={truth} variant="outline" size="sm">
        Edit truth
      </Button>
      <Button onPress={describe} variant="outline" size="sm">
        Title and tags
      </Button>
      <Button onPress={evidence} variant="outline" size="sm">
        Append evidence
      </Button>
      <Button onPress={review} variant="outline" size="sm">
        Review
      </Button>
      {page.kind === "project" ? (
        <Button onPress={delivery} variant="outline" size="sm">
          Delivery
        </Button>
      ) : null}
      {page.kind === "reference" ? (
        <Button onPress={reference} variant="outline" size="sm">
          Evaluate reference
        </Button>
      ) : null}
      <Button onPress={purge} variant="destructive" size="sm">
        Permanently delete
      </Button>
    </View>
  );
}
function PageArticle({
  page,
  scope,
  onEdit,
}: {
  page: KnowledgeRecord;
  scope: KnowledgeScope;
  onEdit(seed: EditorSeed): void;
}) {
  const status = { proposed: "Draft", confirmed: "Confirmed", superseded: "History" }[page.status];
  const timeline = `\`\`\`yaml\n${page.timeline}\n\`\`\``;
  return (
    <SettingsSection title={page.title}>
      <SettingsRow label={status} hint={`${page.kind} · ${page.tags.join(", ")}`} />
      {page.deliveryStatus ? (
        <SettingsRow
          label={`Delivery: ${page.deliveryStatus}`}
          hint={
            page.progress
              ? `${page.progress.completed}/${page.progress.total} ${page.progress.unit} (${page.progress.percentage}%)`
              : undefined
          }
        />
      ) : null}
      {page.referenceDisposition ? (
        <SettingsRow
          label={`Evaluation: ${page.referenceDisposition}`}
          hint={page.sourceUrl ?? undefined}
        />
      ) : null}
      <PageActions page={page} onEdit={onEdit} />
      <MarkdownRenderer text={page.statement} serverId={scope.hostId} />
      <SettingsExpander label="History">
        <MarkdownRenderer text={timeline} />
      </SettingsExpander>
    </SettingsSection>
  );
}
function RootArticle({
  selection,
  body,
  revision,
  onEdit,
}: {
  selection: Extract<KnowledgeSelection, { type: "root" }>;
  body: string;
  revision: string | null;
  onEdit(seed: EditorSeed): void;
}) {
  const edit = useCallback(
    () => onEdit({ root: { slug: selection.slug, body, revision } }),
    [selection.slug, body, revision, onEdit],
  );
  return (
    <SettingsSection title={selection.slug}>
      <Button onPress={edit} variant="outline" size="sm">
        Edit root
      </Button>
      <MarkdownRenderer text={body || "This root has not been written yet."} />
    </SettingsSection>
  );
}
export function KnowledgeDocument({
  scope,
  selection,
  active,
  onEdit,
  onMissing,
}: {
  scope: KnowledgeScope;
  selection: KnowledgeSelection;
  active: boolean;
  onEdit(seed: EditorSeed): void;
  onMissing(): void;
}) {
  const readPage = useRpc(readKnowledgePage);
  const readRoot = useRpc(readKnowledgeRoot);
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: [
      "ottoKnowledge",
      scope.hostId,
      scope.target.kind,
      scope.target.id,
      "document",
      selection,
    ],
    enabled: active,
    retry: false,
    queryFn: async () => {
      if (selection.type === "page") {
        const result = await readPage({ scope, kind: selection.kind, id: selection.id });
        if (!result.ok && result.error.code === "not_found") return { type: "missing" as const };
        if (!result.ok) throw new Error(result.error.message);
        return { type: "page" as const, page: result.value };
      }
      const result = await readRoot({ scope, slug: selection.slug });
      if (!result.ok) throw new Error(result.error.message);
      return { type: "root" as const, root: result.value };
    },
  });
  useEffect(() => {
    if (query.data?.type === "missing") onMissing();
  }, [query.data, onMissing]);
  if (query.data?.type === "missing")
    return <SettingsRow label="This page was removed. Returning to the catalog." />;
  if (query.error) return <Alert variant="error" description={query.error.message} />;
  if (!query.data) return <SettingsRow label="Loading Knowledge..." />;
  if (query.data.type === "page")
    return <PageArticle page={query.data.page} scope={scope} onEdit={onEdit} />;
  if (selection.type !== "root") return null;
  return (
    <RootArticle
      selection={selection}
      body={query.data.root?.body ?? ""}
      revision={query.data.root?.revision ?? null}
      onEdit={onEdit}
    />
  );
}
