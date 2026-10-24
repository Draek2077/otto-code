/** Small host-owned seam for built-ins whose effects must share daemon services. */
export interface OttoBuiltinRpc {
  has(pluginId: string): boolean;
  invoke(
    pluginId: string,
    method: string,
    input: unknown,
    clientId: string,
  ): Promise<unknown> | undefined;
  releaseClient(clientId: string): void;
}
