import type { MutableRefObject, Ref, RefCallback } from "react";

// Combines several refs into one ref callback so a single element can satisfy
// both an existing ref (e.g. a component's own measurement/focus ref) and an
// additional consumer (e.g. the tutorial anchor registry) without wrapping the
// element in an extra View. Accepts object refs, callback refs, and undefined.
export function mergeRefs<T>(
  ...refs: Array<Ref<T> | ((node: T | null) => void) | undefined | null>
): RefCallback<T> {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) {
        continue;
      }
      if (typeof ref === "function") {
        ref(node);
      } else {
        (ref as MutableRefObject<T | null>).current = node;
      }
    }
  };
}
