import type { HostBrowserSource } from "./browser/host/views.js";
/** Small host-owned seam for built-ins whose effects must share daemon services. */
export interface OttoBuiltinRpc {
  has(pluginId: string): boolean;
  invoke(
    pluginId: string,
    method: string,
    input: unknown,
    clientId: string,
    source?: HostBrowserSource,
  ): Promise<unknown> | undefined;
  releaseClient(clientId: string): void;
}
