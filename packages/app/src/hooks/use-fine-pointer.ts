import { useEffect, useState } from "react";
import { isWeb } from "@/constants/platform";

const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

function getHasFinePointer(): boolean {
  if (!isWeb || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(FINE_POINTER_QUERY).matches;
}

/**
 * True when the primary input is a hover-capable mouse/trackpad — a desktop
 * browser or Electron, regardless of window width. False on touch-primary
 * devices and on native, where hover-driven UI (overlay scrollbars, keyboard
 * hints) has no pointer to serve.
 */
export function useHasFinePointer(): boolean {
  const [hasFinePointer, setHasFinePointer] = useState(getHasFinePointer);

  useEffect(() => {
    if (!isWeb || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQuery = window.matchMedia(FINE_POINTER_QUERY);
    const handleChange = () => setHasFinePointer(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener?.("change", handleChange);
    return () => {
      mediaQuery.removeEventListener?.("change", handleChange);
    };
  }, []);

  return hasFinePointer;
}
