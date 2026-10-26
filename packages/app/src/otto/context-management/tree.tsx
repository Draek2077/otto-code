import { ContextEdgeEdit } from "./edge-edit";
import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  changeContextEdge,
  type ContextCategory,
  type ContextReport,
  type ContextSelection,
} from "@getpaseo/plugin/otto/context-management";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { styles } from "./styles";

interface SourceSelection {
  nodeId: string | null;
  category: ContextCategory | null;
}
const categoryNames: Record<ContextCategory, string> = {
  context_files: "Instruction files",
  memory_index: "Memory index",
  skills_roster: "Skills roster",
  mcp_tools: "Tool schemas",
  otto_injected: "Other Otto input",
  system_prompt: "Remaining system text",
};
interface TreeProps {
  report: ContextReport;
  scope: ContextSelection;
  active: boolean;
  onSelect(value: SourceSelection): void;
  onChanged(): void;
}
function CategoryRow({
  row,
  onSelect,
}: {
  row: ContextReport["categories"][number];
  onSelect(value: SourceSelection): void;
}) {
  const select = useCallback(
    () => onSelect({ nodeId: null, category: row.category }),
    [onSelect, row.category],
  );
  return (
    <SettingsRow
      label={categoryNames[row.category]}
      hint={`${row.estimatedTokens === null ? "Not visible" : `${row.estimatedTokens.toLocaleString()} estimated tokens`} · ${row.explanation}`}
    >
      <Button
        variant="outline"
        size="sm"
        onPress={select}
        disabled={row.visibility === "not_visible"}
      >
        Inspect
      </Button>
    </SettingsRow>
  );
}
function edgeHint(edge: ContextReport["edges"][number]): string {
  if (edge.editable === false)
    return "Read-only dependency · this provider's load mode cannot be rewritten here.";
  return edge.kind === "import" ? "Always load" : "Link only · not fixed prompt weight";
}
function EdgeRow({
  edge,
  report,
  scope,
  active,
  onChanged,
}: { edge: ContextReport["edges"][number] } & Omit<TreeProps, "onSelect">) {
  const mutate = useRpc(changeContextEdge);
  const model = useMemo(() => new ContextEdgeEdit(), []);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => (active ? model.activate() : undefined), [active, model]);
  const change = useCallback(
    () =>
      model.change(
        () =>
          confirmDialog({
            title:
              edge.kind === "import" ? "Make this source link-only?" : "Always load this source?",
            message:
              "This changes one dependency in the owning workspace's instruction file. Other imports may still load the same target. Existing provider sessions may retain earlier context; the graph never rewrites conversation history.",
            confirmLabel: "Change load mode",
          }),
        async () => {
          const result = await mutate({
            ...scope,
            revision: report.revision,
            edgeId: edge.id,
            mode: edge.kind === "import" ? "reference" : "import",
          });
          if (!result.ok) return { ok: false as const, message: result.error.message };
          return { ok: true as const };
        },
        onChanged,
      ),
    [edge.id, edge.kind, model, mutate, onChanged, report.revision, scope],
  );
  return (
    <View>
      <SettingsRow label={edge.target} hint={edgeHint(edge)}>
        <Button
          variant="outline"
          size="sm"
          onPress={change}
          disabled={!active || state.busy || state.blocked || !edge.to || edge.editable === false}
        >
          {state.busy ? "Saving..." : "Change load mode"}
        </Button>
      </SettingsRow>
      {state.saved ? (
        <Alert
          variant="info"
          description="Saved for future instruction reads. A captured request and conversation history remain unchanged."
        />
      ) : null}
      {state.error ? <Alert variant="error" description={state.error} /> : null}
    </View>
  );
}
function SourceRow({
  node,
  report,
  scope,
  active,
  onSelect,
  onChanged,
}: { node: ContextReport["nodes"][number] } & TreeProps) {
  const select = useCallback(
    () => onSelect({ nodeId: node.id, category: null }),
    [node.id, onSelect],
  );
  return (
    <SettingsCard testID={`context-source-${node.id}`}>
      <SettingsRow
        label={node.label}
        hint={`${node.scope} · ${node.costClass} · ${node.costClass === "referenced" ? "available to read; not loaded" : `${node.estimatedTokens.toLocaleString()} estimated tokens`}`}
      >
        <Button variant="outline" size="sm" onPress={select}>
          Inspect source
        </Button>
      </SettingsRow>
      {node.editable
        ? report.edges
            .filter((edge) => edge.from === node.id)
            .map((edge) => (
              <EdgeRow
                key={`${edge.id}/${report.revision}`}
                edge={edge}
                report={report}
                scope={scope}
                active={active}
                onChanged={onChanged}
              />
            ))
        : null}
    </SettingsCard>
  );
}
export function ContextTree(props: TreeProps) {
  return (
    <>
      <SettingsSection
        title="Sent before you type"
        info="Each visible source is counted once. Links are available to read and do not add fixed weight. Missing provider categories remain visible as unknown."
      >
        <SettingsCard>
          {props.report.categories.map((row) => (
            <CategoryRow key={row.category} row={row} onSelect={props.onSelect} />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Source graph">
        {props.report.nodes.length ? (
          props.report.nodes.map((node) => <SourceRow key={node.id} node={node} {...props} />)
        ) : (
          <SettingsRow label="No instruction sources are visible for this selection." />
        )}
      </SettingsSection>
      {props.report.findings.length ? (
        <SettingsSection title="Findings">
          {[...new Set(props.report.findings)].map((finding) => (
            <Alert key={finding} variant="warning" description={finding} />
          ))}
        </SettingsSection>
      ) : null}
      <View style={styles.actions} />
    </>
  );
}
