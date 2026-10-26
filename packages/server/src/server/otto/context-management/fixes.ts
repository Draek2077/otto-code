import type {
  ContextFinding,
  ContextReport,
  ContextFixOutcome,
} from "@getpaseo/plugin/otto/context-management";
import type { GraphSource } from "./graph.js";
import { ContextBusy, ContextConflict, rewriteContextFile } from "./source-write.js";
import { removeFindingRanges } from "./finding-edits.js";
/** Recompute findings on the host; callers submit IDs, never paths or trusted deletion ranges. */
export async function applyContextFindingFixes(input: {
  root: string;
  nodes: ContextReport["nodes"];
  sources: Map<string, GraphSource>;
  findings: ContextFinding[];
  findingIds: string[];
}): Promise<ContextFixOutcome[]> {
  const byId = new Map(input.findings.map((finding) => [finding.id, finding]));
  const byFile = new Map<string, ContextFinding[]>();
  for (const id of new Set(input.findingIds)) {
    const finding = byId.get(id);
    if (!finding || !finding.fixable || !input.sources.get(finding.nodeId)?.editable)
      throw new ContextConflict(
        "A selected issue is no longer mechanically fixable. Refresh and review it before changing files.",
      );
    if (input.sources.get(finding.nodeId)!.revision !== finding.sourceRevision)
      throw new ContextConflict(
        "The finding and its owning source no longer share a revision. Refresh before applying fixes.",
      );
    const group = byFile.get(finding.nodeId) ?? [];
    group.push(finding);
    byFile.set(finding.nodeId, group);
  }
  const result: ContextFixOutcome[] = [];
  for (const [nodeId, findings] of byFile) {
    const source = input.sources.get(nodeId)!;
    const label = input.nodes.find((node) => node.id === nodeId)!.label;
    try {
      const changed = await rewriteContextFile({
        root: input.root,
        file: source.file,
        expectedRevision: source.revision,
        rewrite(before) {
          return removeFindingRanges(
            before,
            findings.map((finding) => ({
              ...finding.range,
              snippet: source.text.slice(finding.range.start, finding.range.end),
            })),
          );
        },
      });
      result.push({
        nodeId,
        label,
        status: changed ? "changed" : "unchanged",
        fixedCount: changed ? findings.length : 0,
        message: changed
          ? "Reviewed removals saved for future instruction reads."
          : "No file content changed.",
      });
    } catch (error) {
      result.push({ nodeId, label, fixedCount: 0, ...failure(error) });
    }
  }
  return result;
}
function failure(error: unknown): Pick<ContextFixOutcome, "status" | "message"> {
  if (error instanceof ContextConflict) return { status: "conflict", message: error.message };
  if (error instanceof ContextBusy) return { status: "unavailable", message: error.message };
  return {
    status: "unavailable",
    message:
      "The host could not confirm this file's change. It may have changed; reload and review before further edits.",
  };
}
