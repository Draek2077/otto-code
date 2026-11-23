import type { PluginServerContext } from "@getpaseo/plugin/server";
// Shared credentials and metadata belong to the daemon RPC owner, never plugin settings.
export default function contribute(_server: PluginServerContext) {
  return () => {};
}
