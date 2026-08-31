import { createOttoApi, type OttoApi } from "@otto-code/client";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";

export interface PluginSurfaceRuntime {
  otto: OttoApi;
  invoke(method: string, input: unknown): Promise<unknown>;
}

export function createPluginSurfaceRuntime(
  client: DaemonClient | null,
  pluginId: string,
): PluginSurfaceRuntime | null {
  if (!client) return null;
  return {
    otto: createOttoApi(client),
    invoke: (method, input) => client.invokePluginRpc(pluginId, method, input),
  };
}
