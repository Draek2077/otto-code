import { useCallback, useMemo, useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import {
  readKnowledgeLinkHealth,
  type KnowledgeScope,
} from "@getpaseo/plugin/otto/project-knowledge";
import type { z } from "zod";
import { useFetchQuery } from "@/data/query";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { KnowledgeSelection } from "./document";

type Report = Extract<z.infer<typeof readKnowledgeLinkHealth.output>, { ok: true }>["value"];
function Issue({
  issue,
  onSelect,
}: {
  issue: Report["issues"][number];
  onSelect(selection: KnowledgeSelection): void;
}) {
  const open = useCallback(() => onSelect(issue.source), [issue.source, onSelect]);
  const source = issue.source.type === "page" ? issue.source.id : issue.source.slug;
  return (
    <SettingsAction
      label={source}
      hint={`Missing or inactive target: [[${issue.target}]]`}
      actionLabel="Open source"
      onPress={open}
    />
  );
}

/** Explicit read-only inspection, sharing the canonical project cache and feed. */
export function KnowledgeLinkHealth({
  scope,
  active,
  onSelect,
}: {
  scope: KnowledgeScope;
  active: boolean;
  onSelect(selection: KnowledgeSelection): void;
}) {
  const read = useRpc(readKnowledgeLinkHealth);
  const [checked, setChecked] = useState(false);
  const [offset, setOffset] = useState(0);
  const report = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    retry: false,
    enabled: active && checked,
    queryKey: ["ottoKnowledge", scope.hostId, scope.target.kind, scope.target.id, "links", offset],
    queryFn: async () => {
      const result = await read({ scope, offset, limit: 50 });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const { refetch } = report;
  const check = useCallback(() => {
    if (!active) return;
    if (checked) void refetch();
    else setChecked(true);
  }, [active, checked, refetch]);
  const previous = useCallback(() => setOffset(Math.max(0, offset - 50)), [offset]);
  const data = report.error ? undefined : report.data;
  const nextOffset = data?.nextOffset;
  const next = useCallback(() => {
    if (nextOffset != null) setOffset(nextOffset);
  }, [nextOffset]);
  const issues = useMemo(
    () =>
      data?.issues.map((issue) => {
        const source =
          issue.source.type === "page"
            ? `page/${issue.source.kind}/${issue.source.id}`
            : `root/${issue.source.slug}`;
        return (
          <Issue key={JSON.stringify([source, issue.target])} issue={issue} onSelect={onSelect} />
        );
      }),
    [data, onSelect],
  );
  return (
    <SettingsSection title="Link health" testID="knowledge-link-health">
      <SettingsCard>
        <SettingsRow
          label="Current confirmed pages and project roots"
          hint="Draft and History targets are inactive. Historical timeline links are excluded; checking never rewrites data."
        >
          <Button
            variant="outline"
            size="sm"
            onPress={check}
            disabled={!active || report.isFetching}
          >
            {report.isFetching ? "Checking..." : "Check links"}
          </Button>
        </SettingsRow>
        {report.error ? <Alert variant="error" description={report.error.message} /> : null}
        {data ? (
          <SettingsRow
            label={data.total ? `${data.total} unresolved links` : "No unresolved links."}
          />
        ) : null}
        {issues}
        {data && (offset > 0 || nextOffset !== null) ? (
          <SettingsRow label="Results">
            <Button
              variant="outline"
              size="sm"
              onPress={previous}
              disabled={!offset || report.isFetching}
            >
              Previous links
            </Button>
            <Button
              variant="outline"
              size="sm"
              onPress={next}
              disabled={nextOffset == null || report.isFetching}
            >
              Next links
            </Button>
          </SettingsRow>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
