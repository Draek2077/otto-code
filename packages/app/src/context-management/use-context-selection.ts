import { useCallback, useEffect, useState } from "react";
import type { ContextCategory, ContextNode, ContextReport } from "@otto-code/protocol/messages";
import { pickInitialNode } from "./graph-model";

/**
 * What the right-hand pane is showing, and the one rule that governs it: a file
 * and a prompt section share the pane, and whichever was picked last owns it.
 *
 * Lifted out of the panel because the rule is easy to break from three call
 * sites - the tree, the fix list's reveal, and the report re-seed all move this
 * selection, and each of them getting the precedence right independently is how
 * two rows end up highlighted at once.
 */
export interface ContextSelection {
  node: ContextNode | null;
  /** Non-null while a prompt section owns the pane, displacing `node`. */
  category: ContextCategory | null;
  /** The tree row to highlight - nothing, while a prompt row is selected. */
  highlightNodeId: string | null;
  /** Something is on screen in the pane, file or section. */
  hasSelection: boolean;
  /** Compact drills down to the pane; false is the tree screen. */
  showsPane: boolean;
  selectNode: (node: ContextNode) => void;
  selectCategory: (category: ContextCategory) => void;
  goBack: () => void;
}

export function useContextSelection(params: {
  report: ContextReport | null;
  isCompact: boolean;
}): ContextSelection {
  const { report, isCompact } = params;
  const [node, setNode] = useState<ContextNode | null>(null);
  const [category, setCategory] = useState<ContextCategory | null>(null);
  const [showsPane, setShowsPane] = useState(false);

  // Re-seed when a different report arrives (provider or window changed), but
  // never stomp a selection the user made themselves.
  useEffect(() => {
    if (!report) return;
    setNode((current) => {
      if (current && report.nodes.some((entry) => entry.id === current.id)) return current;
      return pickInitialNode(report);
    });
    // Switching provider can take a prompt category out of the tree entirely -
    // it drops out once the daemon says it cannot see it. Reading a section with
    // no row behind it would be a pane the user cannot navigate back to.
    setCategory((current) => {
      if (!current) return current;
      const total = report.categoryTotals.find((entry) => entry.category === current);
      return total && total.visibility !== "not_visible" ? current : null;
    });
  }, [report]);

  const selectNode = useCallback(
    (next: ContextNode) => {
      setNode(next);
      setCategory(null);
      if (isCompact) setShowsPane(true);
    },
    [isCompact],
  );

  const selectCategory = useCallback(
    (next: ContextCategory) => {
      setCategory(next);
      if (isCompact) setShowsPane(true);
    },
    [isCompact],
  );

  const goBack = useCallback(() => setShowsPane(false), []);

  return {
    node,
    category,
    highlightNodeId: category ? null : (node?.id ?? null),
    hasSelection: category != null || node != null,
    showsPane,
    selectNode,
    selectCategory,
    goBack,
  };
}
