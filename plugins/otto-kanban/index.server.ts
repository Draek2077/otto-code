import type { PluginServerContext } from "@getpaseo/plugin/server";

// Project metadata and forge policy belong to the daemon's registered Kanban RPC owner.
// Paseo's eager bundle interop captures exports before variable initialization.
export default function contribute(_server: PluginServerContext) {
  return () => {};
}
