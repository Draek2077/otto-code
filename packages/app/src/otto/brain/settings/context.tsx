import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import type { BrainSettingsPort, BrainSettingsSnapshot } from "./contracts";
import type { BrainSettingsFormModel, BrainSettingsFormState } from "./form-model";
import { useIsCompactFormFactor } from "@/constants/layout";

type InputScope = "connection" | "owner";
interface SettingsContextValue {
  port: BrainSettingsPort;
  snapshot: BrainSettingsSnapshot;
  model: BrainSettingsFormModel;
  state: BrainSettingsFormState;
  active: boolean;
  registerInput: (scope: InputScope, flush: () => void) => () => void;
  flushInputs: (scope?: InputScope) => void;
}

const Context = createContext<SettingsContextValue | null>(null);

export function BrainSettingsProvider({
  children,
  port,
  snapshot,
  model,
  state,
  active,
}: Omit<SettingsContextValue, "registerInput" | "flushInputs"> & { children: ReactNode }) {
  const inputs = useRef(new Map<() => void, InputScope>());
  const registerInput = useCallback((scope: InputScope, flush: () => void) => {
    inputs.current.set(flush, scope);
    return () => {
      inputs.current.delete(flush);
    };
  }, []);
  const flushInputs = useCallback((scope?: InputScope) => {
    for (const [flush, registeredScope] of inputs.current) {
      if (!scope || scope === registeredScope) flush();
    }
  }, []);
  const context = useMemo(
    () => ({ port, snapshot, model, state, active, registerInput, flushInputs }),
    [port, snapshot, model, state, active, registerInput, flushInputs],
  );
  return <Context value={context}>{children}</Context>;
}

export function useBrainSettings() {
  const value = useContext(Context);
  if (!value) throw new Error("BrainSettingsProvider is required");
  return value;
}

export function useSettingsDisabled(scope: InputScope): boolean {
  const { state, snapshot, active } = useBrainSettings();
  const domain = state[scope];
  return (
    !active ||
    !snapshot.host.connected ||
    state.operation !== null ||
    domain?.blocked === true ||
    (scope === "owner" && state.targetChanged)
  );
}

export function useSettingsControlSize(): "sm" | "md" {
  return useIsCompactFormFactor() ? "md" : "sm";
}
