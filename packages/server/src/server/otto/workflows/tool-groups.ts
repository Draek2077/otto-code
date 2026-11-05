/** Per-node narrowing, intersected after ordinary host/provider policy. Unknown tools never inherit a selected group. */
export function workflowToolGroup(name: string): string | null {
  if (name.includes("project_knowledge")) return "knowledge";
  if (name.includes("artifact")) return "artifacts";
  if (name.startsWith("preview_")) return "preview";
  if (name.startsWith("browser_")) return "browser";
  if (name.includes("kanban")) return "kanban";
  if (name.includes("terminal")) return "terminal";
  if (name.includes("workflow") || name === "submit_output") return "orchestration";
  if (name.includes("workspace")) return "workspace";
  if (name.includes("schedule")) return "schedules";
  if (name.includes("provider") || name === "list_models") return "providers";
  if (name.includes("agent")) return "agents";
  if (name.startsWith("connector_")) return "connectors";
  return null;
}
export function workflowToolGroupAllowed(
  name: string,
  groups: readonly string[] | undefined,
): boolean {
  if (groups === undefined) return true;
  const group = workflowToolGroup(name);
  return group !== null && groups.includes(group);
}
export function workflowDelegationAllowed(groups: readonly string[] | undefined): boolean {
  return groups === undefined || groups.includes("orchestration") || groups.includes("agents");
}
