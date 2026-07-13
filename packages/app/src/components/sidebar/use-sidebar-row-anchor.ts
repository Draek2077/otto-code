import { useCallback } from "react";
import { registerSidebarRowAnchor, type MeasurableNode } from "./sidebar-row-anchors";

// Returns a stable ref callback that registers/unregisters an element as the
// live node for a sidebar row key. Merge it onto the row's existing ref via
// mergeRefs (never wrap the row in a View — a wrapper perturbs layout/drag and
// breaks measurement). Safe to attach unconditionally: a plain Map write with no
// cost until a reveal is requested.
export function useSidebarRowAnchor(key: string): (node: MeasurableNode | null) => void {
  return useCallback((node: MeasurableNode | null) => registerSidebarRowAnchor(key, node), [key]);
}
