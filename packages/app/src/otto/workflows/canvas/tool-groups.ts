/** Mirrors the host's provider-neutral Workflow tool groups; this list grants no authority. */
export const OTTO_TOOL_GROUP_META = [
  "agents",
  "orchestration",
  "knowledge",
  "artifacts",
  "preview",
  "browser",
  "kanban",
  "terminal",
  "workspace",
  "schedules",
  "providers",
  "connectors",
].map((group) => ({ group, label: group[0].toUpperCase() + group.slice(1) }));
