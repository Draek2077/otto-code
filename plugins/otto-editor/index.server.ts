import type { PluginServerContext } from "@getpaseo/plugin/server";
// File buffers and language-server processes belong to the shared daemon owner.
// The ordinary authenticated plugin RPC channel routes to that owner.
export default function contribute(_server: PluginServerContext) {
  return () => {};
}
