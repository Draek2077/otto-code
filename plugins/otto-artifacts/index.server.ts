import type { PluginServerContext } from "@getpaseo/plugin/server";
/** File authority and generation stay in the daemon's shared Artifacts service. */
export default function contribute(_server: PluginServerContext) {
  return () => {};
}
