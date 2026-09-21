export interface SidebarEdgePointerInput {
  x: number;
  y: number;
  buttons: number;
}

type SidebarEdgePointerListener = (input: SidebarEdgePointerInput) => void;

const listeners = new Set<SidebarEdgePointerListener>();

/**
 * Feeds pointer positions that Electron browser guests consumed back into the
 * same edge-reveal controller used by ordinary app surfaces.
 */
export function publishSidebarEdgePointer(input: SidebarEdgePointerInput): void {
  for (const listener of listeners) {
    listener(input);
  }
}

export function subscribeSidebarEdgePointer(listener: SidebarEdgePointerListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
