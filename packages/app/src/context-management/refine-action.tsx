import { useCallback, useMemo } from "react";
import type { ContextNode, ContextReport } from "@otto-code/protocol/messages";
import { WandStars } from "@/components/icons/material-icons";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { withUnistyles } from "react-native-unistyles";
import { openRefineTab } from "@/refine/open-refine-tab";
import { presetForContextFile } from "@/refine/refine-presets";
import { selectReferencesWithinBudget } from "@/refine/refine-reference-budget";
import { useRefineFeature } from "@/refine/use-refine-feature";

const ThemedWandStars = withUnistyles(WandStars);

/**
 * Context Management's compaction action — the call site
 * projects/context-management/context-management.md §7.4 was blocked on.
 *
 * §7.4's requirement was never "a compact button", it was **"a side-by-side
 * diff with per-hunk accept/reject before anything lands"**, for a file whose
 * entire purpose is behavioural rules. That is the Refine tab, so compaction is
 * a preset here rather than a feature of its own: this button picks the right
 * seed instruction and opens the job.
 *
 * The working set is what makes the result any good. The selected file is the
 * one thing that may be rewritten; the rest of the context graph goes along as
 * **read-only references**, so the rewrite is made knowing what the other
 * instruction files already say — which is exactly how you avoid a "compaction"
 * that deletes a rule because it did not know a sibling file relies on it. The
 * user can widen the rewritable set from the tab, seeing the blast radius as
 * they do it.
 */
export function ContextRefineAction({
  serverId,
  workspaceId,
  report,
  selectedNode,
}: {
  serverId: string;
  workspaceId: string;
  report: ContextReport | null;
  selectedNode: ContextNode | null;
}) {
  const hasRefine = useRefineFeature(serverId);

  // Budgeted, and smallest-first: the whole graph would routinely blow the
  // daemon's per-request ceiling, and a failed round the user cannot act on is
  // worse than a rewrite that saw nine of eleven siblings.
  const references = useMemo(() => {
    if (!report || !selectedNode) {
      return [];
    }
    return selectReferencesWithinBudget(
      report.nodes
        .filter((node) => node.id !== selectedNode.id)
        .map((node) => ({ path: node.path, bytes: node.bytes })),
    );
  }, [report, selectedNode]);

  const open = useCallback(() => {
    if (!selectedNode) {
      return;
    }
    openRefineTab({
      serverId,
      workspaceId,
      paths: [selectedNode.path],
      references,
      presetId: presetForContextFile(selectedNode.relPath).id,
    });
  }, [references, selectedNode, serverId, workspaceId]);

  if (!hasRefine || !selectedNode) {
    return null;
  }

  return (
    <ToolbarIconButton
      label="Compact with AI"
      testID="context-refine-open"
      Icon={ThemedWandStars}
      onPress={open}
    />
  );
}
