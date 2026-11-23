import type { PluginServerContext } from "@getpaseo/plugin/server";
/** Audio models, credentials and request lifetimes belong to the daemon. */
export default function contribute(_server: PluginServerContext) {
  return () => {};
}
