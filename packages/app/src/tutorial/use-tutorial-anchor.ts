import { useCallback } from "react";
import {
  registerTutorialAnchor,
  type MeasurableNode,
  type TutorialAnchorId,
} from "./anchor-registry";

// Returns a stable ref callback that registers/unregisters an element as the
// live node for a tutorial anchor id. Merge it onto a target's existing ref via
// mergeRefs (never wrap the target in a View — a wrapper perturbs layout and
// breaks measurement). Safe to attach unconditionally: registration is a plain
// Map write with no cost when no tour is running.
export function useTutorialAnchor(id: TutorialAnchorId): (node: MeasurableNode | null) => void {
  return useCallback((node: MeasurableNode | null) => registerTutorialAnchor(id, node), [id]);
}
