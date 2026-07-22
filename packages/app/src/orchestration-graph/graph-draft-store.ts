import type { OrchestrationGraph } from "@otto-code/protocol/orchestration";

// In-progress designer edits, held for as long as the app is running.
//
// The designer tab unmounts whenever you switch workspaces or close the pane,
// and a graph is a document: leaving the room is not the same as discarding
// your work. Nothing here is written to the host — the graph on the host still
// only changes when the user saves — but the working copy survives navigation
// so coming back finds the canvas exactly as it was left, still marked unsaved.
//
// Keyed per host + graph so two hosts' graphs of the same id can't collide.

interface GraphDraft {
  graph: OrchestrationGraph;
  /** Whether the working copy still differs from the host's saved version. */
  dirty: boolean;
}

const drafts = new Map<string, GraphDraft>();

function draftKey(serverId: string, graphId: string): string {
  return `${serverId}::${graphId}`;
}

export function getGraphDraft(serverId: string, graphId: string): GraphDraft | null {
  return drafts.get(draftKey(serverId, graphId)) ?? null;
}

export function setGraphDraft(serverId: string, graph: OrchestrationGraph, dirty: boolean): void {
  drafts.set(draftKey(serverId, graph.id), { graph, dirty });
}

export function clearGraphDraft(serverId: string, graphId: string): void {
  drafts.delete(draftKey(serverId, graphId));
}
