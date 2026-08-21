import { createContext, useContext, type PropsWithChildren } from "react";

/**
 * Deterministic interaction state used only by the in-app UI Gallery.
 *
 * A browser can focus only one element and a pointer can hover only one target,
 * so a side-by-side audit needs a way to send the same state through the exact
 * production style path without turning fixtures into lookalike components.
 * Outside a boundary controls continue to use their real interaction events.
 */
export interface ControlStatePreviewValue {
  hovered?: boolean;
  pressed?: boolean;
  focused?: boolean;
  open?: boolean;
  targetId?: string;
}

const ControlStatePreviewContext = createContext<ControlStatePreviewValue | null>(null);

export function ControlStatePreview({
  children,
  ...value
}: PropsWithChildren<ControlStatePreviewValue>) {
  return (
    <ControlStatePreviewContext.Provider value={value}>
      {children}
    </ControlStatePreviewContext.Provider>
  );
}

export function useControlStatePreview(): ControlStatePreviewValue | null {
  return useContext(ControlStatePreviewContext);
}

export function resolvePreviewFlag(forced: boolean | undefined, actual: boolean): boolean {
  return forced ?? actual;
}
