import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ContextNode, ContextReport } from "@otto-code/protocol/messages";
import { Compress } from "@/components/icons/material-icons";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { withUnistyles } from "react-native-unistyles";
import { openRefineTab } from "@/refine/open-refine-tab";
import { presetForContextFile } from "@/refine/refine-presets";
import { selectReferencesWithinBudget } from "@/refine/refine-reference-budget";
import { useRefineFeature } from "@/refine/use-refine-feature";

// Compress, not the wand Refine wears. Both open the same job, so a shared glyph
// read as one button rendered twice; the arrows say what this preset actually
// asks for - the same document, smaller.
const ThemedCompress = withUnistyles(Compress);

/**
 * Context Management's compaction action - the call site
 * docs/context-management.md's AI compaction was blocked on.
 *
 * The requirement was never "a compact button", it was **"a side-by-side
 * diff with per-hunk accept/reject before anything lands"**, for a file whose
 * entire purpose is behavioural rules. That is the Refine tab, so compaction is
 * a preset here rather than a feature of its own: this button picks the right
 * seed instruction and opens the job.
 *
 * It lives beside the graph's own tabs, not in the file toolbar, because it is
 * not an action about the file on screen. The working set is what makes the
 * result any good: the selected file is the one thing that may be rewritten,
 * and the rest of the context graph goes along as **read-only references**, so
 * the rewrite is made knowing what the other instruction files already say -
 * which is exactly how you avoid a "compaction" that deletes a rule because it
 * did not know a sibling file relies on it. The user can widen the rewritable
 * set from the tab, seeing the blast radius as they do it. The file toolbar's
 * Refine is the single-file counterpart, and the two sit apart so that
 * difference is visible rather than something you learn by pressing.
 *
 * Disabled rather than absent while nothing is selected: this row is chrome the
 * eye returns to, and a control that vanishes reflows the tabs beside it.
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
  const { t } = useTranslation();
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

  if (!hasRefine) {
    return null;
  }

  return (
    <ToolbarIconButton
      label={t("refine.compactOpen")}
      testID="context-refine-open"
      Icon={ThemedCompress}
      onPress={open}
      disabled={!selectedNode}
    />
  );
}
