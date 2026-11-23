import type { PluginServerContext } from "@getpaseo/plugin/server";
// Canonical files, identities and writes belong to the daemon host service.
export default function contribute(_server: PluginServerContext) {
  return () => {};
}
