import { useCallback, useLayoutEffect, useRef } from "react";
/** A row/panel's captured lifetime also bounds a shared page mutation lane. */
export function useContextEditOrigin(active: boolean) {
  const current = useRef<object | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const token = {};
    current.current = token;
    return () => {
      if (current.current === token) current.current = null;
    };
  }, [active]);
  return useCallback(() => {
    const token = current.current;
    return () => token !== null && current.current === token;
  }, []);
}
