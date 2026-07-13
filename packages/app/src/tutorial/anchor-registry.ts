// Module-level registry mapping stable tutorial anchor ids to the live,
// measurable node currently mounted for each. Modeled on the portalHostElements
// Map in components/ui/floating-panel-portal.tsx: a plain Map + tiny emitter,
// NOT React state/context. Target components register via a ref callback and
// never subscribe, so starting or stopping the tour re-renders nothing. Only
// the tutorial controller subscribes (to learn when a just-navigated-to target
// has mounted and become measurable).

export type TutorialAnchorId =
  | "settings"
  | "add-project"
  | "workspaces"
  | "explorer-toggle"
  | "chat-input";

// The minimal shape we need off a host component to place the spotlight. RN
// View/Pressable instances (native and react-native-web) both expose this.
export interface MeasurableNode {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

const nodes = new Map<TutorialAnchorId, MeasurableNode>();
const listeners = new Map<TutorialAnchorId, Set<() => void>>();

function emit(id: TutorialAnchorId): void {
  const set = listeners.get(id);
  if (!set) {
    return;
  }
  for (const cb of set) {
    cb();
  }
}

export function registerTutorialAnchor(id: TutorialAnchorId, node: MeasurableNode | null): void {
  if (node) {
    nodes.set(id, node);
  } else {
    nodes.delete(id);
  }
  emit(id);
}

export function getTutorialAnchorNode(id: TutorialAnchorId): MeasurableNode | null {
  return nodes.get(id) ?? null;
}

// Subscribe to registration/unregistration of a single anchor. Returns an
// unsubscribe. Controller-only — target components must never call this.
export function subscribeTutorialAnchor(id: TutorialAnchorId, cb: () => void): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}
