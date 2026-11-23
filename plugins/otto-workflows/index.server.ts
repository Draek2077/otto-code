import type { PluginServerContext } from "@getpaseo/plugin/server";
/** Composition and lifecycle belong to the shared daemon owner, not the plugin process. */
export default function contribute(_server: PluginServerContext) {
  return () => {};
}
