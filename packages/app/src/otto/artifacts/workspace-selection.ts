import type { ArtifactRef } from "@getpaseo/plugin/otto/artifacts";
const selected = new Map<string, ArtifactRef>();
const listeners = new Set<() => void>();
let revision = 0;
const key = (serverId: string, workspaceId: string) => JSON.stringify([serverId, workspaceId]);
/** Bounded navigation intent, never another Artifact/data store. The host owns the document. */
export const artifactWorkspaceSelection = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => revision,
  read(serverId: string, workspaceId: string) {
    return selected.get(key(serverId, workspaceId));
  },
  select(serverId: string, workspaceId: string, reference: ArtifactRef) {
    if (reference.scope.hostId !== serverId) throw new Error("Choose an Artifact on this host.");
    const id = key(serverId, workspaceId);
    selected.delete(id);
    selected.set(id, reference);
    if (selected.size > 128) selected.delete(selected.keys().next().value!);
    revision++;
    for (const listener of listeners) listener();
  },
  clear(serverId: string, workspaceId: string) {
    selected.delete(key(serverId, workspaceId));
    revision++;
    for (const listener of listeners) listener();
  },
};
