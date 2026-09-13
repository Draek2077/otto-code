import { useCallback, type ReactNode } from "react";
import { PluginClientStateProvider, usePluginClientStateSource } from "./client-state.js";
import { OttoApiProvider, useOttoContextValue } from "./otto-context.js";
import { PluginRpcProvider, usePluginRpcContextValue } from "./rpc-context.js";

export type PluginRuntimeContextBridge = (children: ReactNode) => ReactNode;

/** Rebuilds plugin runtime contexts inside React Native portal hosts. */
export function usePluginRuntimeContextBridge(): PluginRuntimeContextBridge {
  const otto = useOttoContextValue();
  const rpc = usePluginRpcContextValue();
  const state = usePluginClientStateSource();

  if (!otto || !rpc) {
    throw new Error("Plugin UI must run inside a contributed plugin surface");
  }

  return useCallback(
    (children: ReactNode) => {
      const content = state ? (
        <PluginClientStateProvider source={state}>{children}</PluginClientStateProvider>
      ) : (
        children
      );
      return (
        <OttoApiProvider otto={otto}>
          <PluginRpcProvider invoke={rpc.invoke}>{content}</PluginRpcProvider>
        </OttoApiProvider>
      );
    },
    [otto, rpc, state],
  );
}
