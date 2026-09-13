/** Both author namespaces use the same host runtime and directory boundaries. */
export const PLUGIN_SDK_NAMESPACES = ["@otto-code/plugin", "@getpaseo/plugin"] as const;
export type PluginSdkNamespace = "otto" | "paseo";
const entries = {
  "": "shared",
  "/client": "client",
  "/client/ui": "client",
  "/client/react-native": "client",
  "/server": "server",
  "/server/provider": "server",
  "/server/acp": "server",
} as const;

export function resolvePluginSdkSpecifier(specifier: string) {
  for (const namespace of PLUGIN_SDK_NAMESPACES) {
    if (specifier !== namespace && !specifier.startsWith(`${namespace}/`)) continue;
    const entry = specifier.slice(namespace.length);
    if (!Object.hasOwn(entries, entry)) return undefined;
    return {
      namespace: namespace === "@otto-code/plugin" ? ("otto" as const) : ("paseo" as const),
      entry: entry as keyof typeof entries,
      runtime: entries[entry as keyof typeof entries],
      canonical: `@otto-code/plugin${entry}`,
    };
  }
  return undefined;
}

export function isPluginSdkSpecifier(specifier: string): boolean {
  return PLUGIN_SDK_NAMESPACES.some(
    (namespace) => specifier === namespace || specifier.startsWith(`${namespace}/`),
  );
}
export function isPluginHostSdkSpecifier(specifier: string): boolean {
  return PLUGIN_SDK_NAMESPACES.some((namespace) => specifier === `${namespace}/client/host`);
}
export const PLUGIN_SDK_SPECIFIERS = PLUGIN_SDK_NAMESPACES.flatMap((namespace) =>
  Object.keys(entries).map((entry) => `${namespace}${entry}`),
);
export const PLUGIN_CLIENT_ONLY_SDK_SPECIFIERS = PLUGIN_SDK_SPECIFIERS.filter(
  (specifier) => resolvePluginSdkSpecifier(specifier)?.runtime === "client",
);
export function isPluginClientOnlySdkSpecifier(specifier: string): boolean {
  return resolvePluginSdkSpecifier(specifier)?.runtime === "client";
}
export function isPluginServerOnlySdkSpecifier(specifier: string): boolean {
  return resolvePluginSdkSpecifier(specifier)?.runtime === "server";
}
