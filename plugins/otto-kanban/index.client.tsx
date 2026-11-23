import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createKanbanClientContribution } from "./client/contribution.js";

// Keep the default export hoisted for Paseo's eager bundle interop.
export default function contribute(client: PluginClientContext) {
  return createKanbanClientContribution()(client);
}
