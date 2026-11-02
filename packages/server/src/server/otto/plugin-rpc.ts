import type { HostBrowserSource } from "./browser/host/views.js";
export type OttoBuiltinRoute = (
  method: string,
  input: unknown,
  clientId: string,
  source?: HostBrowserSource,
) => Promise<unknown> | undefined;
export function invokeOttoBuiltin(
  routes: Readonly<Record<string, OttoBuiltinRoute>>,
  pluginId: string,
  method: string,
  input: unknown,
  clientId: string,
  source?: HostBrowserSource,
) {
  if (!Object.hasOwn(routes, pluginId)) return undefined;
  return routes[pluginId]?.(method, input, clientId, source);
}
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
