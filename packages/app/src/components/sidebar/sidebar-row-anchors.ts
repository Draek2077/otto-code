// Module-level registry mapping a stable sidebar row key to the live, measurable
// node currently mounted for it. Same shape as tutorial/anchor-registry.ts and
// the portalHostElements Map: a plain Map + tiny emitter, NOT React state. Rows
// register via a ref callback (useSidebarRowAnchor) and never subscribe, so this
// costs nothing until something reveals. Only the per-scroll-container reveal
// controller subscribes, to learn when a target row has mounted and settled.
//
// Two row kinds are addressable: a workspace row and a project (header/block)
// row. Keys are built with workspaceRowKey / projectRowKey so producers and the
// reveal store agree on the string.

export interface MeasurableNode {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

export function workspaceRowKey(serverId: string, workspaceId: string): string {
  return `workspace:${serverId}:${workspaceId}`;
}

export function projectRowKey(projectKey: string): string {
  return `project:${projectKey}`;
}

const nodes = new Map<string, MeasurableNode>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of listeners) {
    cb();
  }
}

export function registerSidebarRowAnchor(key: string, node: MeasurableNode | null): void {
  if (node) {
    nodes.set(key, node);
  } else {
    nodes.delete(key);
  }
  emit();
}

export function getSidebarRowAnchorNode(key: string): MeasurableNode | null {
  return nodes.get(key) ?? null;
}

// Subscribe to any registration change. Returns an unsubscribe. Reveal
// controllers use this to retry a measure once a just-expanded row mounts.
export function subscribeSidebarRowAnchors(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
