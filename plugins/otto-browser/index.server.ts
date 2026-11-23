import type { PluginServerContext } from "@getpaseo/plugin/server";
/** Browser sessions and project history share daemon-owned services, not plugin settings. */
export default function contribute(_server: PluginServerContext) {
  return () => {};
}
