import type { PluginServerContext } from "@getpaseo/plugin/server";
/** Settings live in Host → Terminals; effects share the daemon's PTY manager. */
export default function contribute(_server: PluginServerContext) {
  return () => {};
}
