import React, { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  fixContextFindings,
  type ContextFinding,
  type ContextFixOutcome,
  type ContextReport,
  type ContextSelection,
} from "@getpaseo/plugin/otto/context-management";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { ContextEdgeEdit, ContextEdgeEditState } from "./edge-edit";
import type { ContextSourceSelection } from "./selection";
import { useContextEditOrigin } from "./use-edit-origin";
import { styles } from "./styles";
interface IssuesProps {
  report: ContextReport;
  scope: ContextSelection;
  active: boolean;
  visible: boolean;
  writeModel: ContextEdgeEdit;
  writeState: ContextEdgeEditState;
  onSelect(value: ContextSourceSelection): void;
  onChanged(): void;
}
const findingLabels: Record<ContextFinding["kind"], string> = {
  dead_import: "Missing instruction",
  dead_reference: "Missing reference",
  import_cycle: "Import cycle",
  depth_capped: "Import depth limit",
  duplicate_across_scope: "Repeated across scopes",
  duplicate_within_file: "Repeated in this file",
  oversized_memory_entry: "Long memory entry",
};
function IssueRow({
  finding,
  node,
  disabled,
  onSelect,
}: {
  finding: ContextFinding;
  node: ContextReport["nodes"][number] | undefined;
  disabled: boolean;
  onSelect(value: ContextSourceSelection): void;
}) {
  const inspect = useCallback(
    () =>
      onSelect({
        nodeId: finding.nodeId,
        category: null,
        findingId: finding.id,
        sourceRevision: finding.sourceRevision,
        line: finding.line,
        lineEnd: finding.lineEnd,
      }),
    [finding.id, finding.line, finding.lineEnd, finding.nodeId, finding.sourceRevision, onSelect],
  );
  return (
    <SettingsCard testID={`context-issue-${finding.id}`}>
      <SettingsRow
        label={`${node?.label ?? "Source unavailable"} · line ${finding.line}`}
        hint={`${findingLabels[finding.kind]} · ${node?.scope ?? "unknown scope"}. ${finding.message}`}
      >
        <Button variant="outline" size="sm" onPress={inspect} disabled={disabled || !node}>
          Inspect issue
        </Button>
      </SettingsRow>
      <Text selectable style={styles.code}>
        {finding.snippet}
      </Text>
    </SettingsCard>
  );
}
export function ContextIssues(props: IssuesProps) {
  const { onChanged } = props;
  const invoke = useRpc(fixContextFindings);
  const captureOrigin = useContextEditOrigin(props.active && props.visible);
  const staged = useRef<ContextFixOutcome[]>([]);
  const [outcomes, setOutcomes] = useState<ContextFixOutcome[]>([]);
  const findings = props.report.findingDetails;
  const fixable = useMemo(() => findings?.filter((finding) => finding.fixable) ?? [], [findings]);
  const fix = useCallback(
    () =>
      props.writeModel.change(
        () =>
          confirmDialog({
            title: "Apply mechanical fixes?",
            message: `Review the ${fixable.length} selected missing references or repeated blocks before removing them. Canonical copies are retained; ordering and scope can still matter. This changes future instruction reads, not conversation history.`,
            confirmLabel: "Apply fixes",
          }),
        async () => {
          staged.current = [];
          const result = await invoke({
            ...props.scope,
            revision: props.report.revision,
            findingIds: fixable.map((finding) => finding.id),
            userApprovedFixes: true,
          });
          if (!result.ok) return { ok: false as const, message: result.error.message };
          staged.current = result.value.files;
          return { ok: true as const };
        },
        () => {
          setOutcomes(staged.current);
          onChanged();
        },
        captureOrigin(),
        "issues",
      ),
    [
      captureOrigin,
      fixable,
      invoke,
      onChanged,
      props.report.revision,
      props.scope,
      props.writeModel,
    ],
  );
  if (!props.visible) return null;
  if (!findings)
    return (
      <Alert
        variant="info"
        description="Update the host to inspect Context issues and apply reviewed fixes."
      />
    );
  return (
    <SettingsSection
      title="Issues"
      info="Deterministic findings, at most 256 per inspection. Missing files and exact duplicate prose can be removed after review; cycles, depth limits, code examples and memory restructuring require judgment."
    >
      <View style={styles.actions}>
        <Button
          variant="outline"
          size="sm"
          onPress={fix}
          disabled={
            !props.active || props.writeState.busy || props.writeState.blocked || !fixable.length
          }
        >
          Fix all
        </Button>
      </View>
      {outcomes.map((outcome) => (
        <Alert
          key={outcome.nodeId}
          testID={`context-fix-result-${outcome.nodeId}`}
          variant={
            outcome.status === "changed" || outcome.status === "unchanged" ? "info" : "error"
          }
          description={`${outcome.label}: ${outcome.message}`}
        />
      ))}
      {findings.map((finding) => (
        <IssueRow
          key={finding.id}
          finding={finding}
          node={props.report.nodes.find((node) => node.id === finding.nodeId)}
          disabled={!props.active || props.writeState.busy}
          onSelect={props.onSelect}
        />
      ))}
      {!findings.length ? (
        <SettingsRow label="No deterministic issues found in the visible sources." />
      ) : null}
    </SettingsSection>
  );
}
