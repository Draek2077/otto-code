import type { PluginServerContribution } from "@getpaseo/plugin/server";

// Project metadata and forge policy belong to the daemon's registered Kanban RPC owner.
const contribute: PluginServerContribution = () => () => {};
export default contribute;
