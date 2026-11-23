import {
  workflowRefKey,
  type WorkflowScope,
  type WorkflowEntry,
  type WorkflowAuthoredDocument,
} from "@getpaseo/plugin/otto/workflows";
import { WorkflowDraft } from "./draft";
const owners = new WeakMap<object, Map<string, { surface: string; model: WorkflowDraft }>>();
export function draftFor(
  owner: object,
  scope: WorkflowScope,
  surface: string,
  document: WorkflowAuthoredDocument,
  origin: WorkflowEntry | null,
) {
  let store = owners.get(owner);
  if (!store) {
    store = new Map();
    owners.set(owner, store);
  }
  const key = JSON.stringify([
    scope.hostId,
    scope.projectId,
    surface,
    origin ? workflowRefKey(origin.ref) : [document.kind, document.value.id],
  ]);
  const found = store.get(key);
  if (found) return found.model;
  if (store.size >= 16) {
    const free = [...store].find(([, item]) => {
      const state = item.model.getSnapshot();
      return !state.dirty && !state.busy && !state.blocked;
    });
    if (!free)
      throw new Error(
        "Save or explicitly discard an existing Workflow draft before opening another.",
      );
    store.delete(free[0]);
  }
  const model = new WorkflowDraft(scope, document, origin);
  store.set(key, { surface, model });
  return model;
}
export function workflowDrafts(owner: object, scope: WorkflowScope, surface: string) {
  return [...(owners.get(owner)?.values() ?? [])]
    .filter(
      (item) =>
        item.surface === surface &&
        item.model.scope.hostId === scope.hostId &&
        item.model.scope.projectId === scope.projectId,
    )
    .map((item) => item.model);
}
export function discardWorkflowDraft(owner: object, model: WorkflowDraft) {
  if (model.getSnapshot().busy) return false;
  const store = owners.get(owner);
  if (!store) return false;
  for (const [key, item] of store)
    if (item.model === model) {
      store.delete(key);
      return true;
    }
  return false;
}
