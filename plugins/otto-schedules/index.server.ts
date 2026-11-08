import type { PluginServerContext } from "@getpaseo/plugin/server";
/** The daemon composes the single scheduler and target owners. No plugin clock or provider. */
export default function contribute(_server: PluginServerContext) {
  return () => {};
}
