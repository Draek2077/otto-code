import type { PluginServerContext } from "@getpaseo/plugin/server";
/** Canonical files, renderer admission and authoring identity belong to the shared daemon owner. */
export default function contribute(_server: PluginServerContext) {
  return () => {};
}
