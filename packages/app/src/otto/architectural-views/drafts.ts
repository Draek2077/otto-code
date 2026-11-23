import type {
  ViewDraft,
  ViewOrigin,
  ViewIdentity,
} from "@getpaseo/plugin/otto/architectural-views";
import { ViewDraftModel, type DraftDocument, type DraftPorts } from "./draft-model";
const installations = new WeakMap<object, Map<string, ViewDraftModel>>();
export function findViewDraftModel(
  installation: object,
  hostId: string,
  identity: ViewIdentity,
  draftId: string,
) {
  return installations.get(installation)?.get(JSON.stringify([hostId, identity, draftId]));
}
/** Retain only local editing intent across navigation; bounded, no sockets or canonical cache. */
export function viewDraftModel(
  installation: object,
  hostId: string,
  identity: ViewIdentity,
  document: DraftDocument,
  ports: DraftPorts,
): ViewDraftModel {
  let entries = installations.get(installation);
  if (!entries) {
    entries = new Map();
    installations.set(installation, entries);
  }
  const key = JSON.stringify([hostId, identity, document.draft.draftId]);
  const previous = entries.get(key);
  if (previous) return previous;
  if (entries.size >= 50) {
    for (const [entryKey, model] of entries) {
      if (model.canForget()) {
        entries.delete(entryKey);
        break;
      }
    }
  }
  if (entries.size >= 50)
    throw new Error("Finish or discard an existing local View edit before opening more drafts.");
  const model = new ViewDraftModel(document, ports);
  entries.set(key, model);
  return model;
}
export function forgetViewDraft(installation: object, model: ViewDraftModel): void {
  const entries = installations.get(installation);
  for (const [key, value] of entries ?? []) if (value === model) entries?.delete(key);
}

export function recoverableViewDrafts(
  installation: object,
  hostId: string,
  origins: ViewOrigin[],
): ViewDraft[] {
  const result: ViewDraft[] = [];
  for (const [key, model] of installations.get(installation) ?? []) {
    const state = model.getSnapshot();
    if (JSON.parse(key)[0] !== hostId || (!state.dirty && !state.blocked && !state.busy)) continue;
    if (
      origins.some(
        (origin) =>
          origin.storeKey === state.draft.origin.storeKey &&
          origin.location === state.draft.origin.location,
      )
    )
      result.push(state.draft);
  }
  return result;
}
