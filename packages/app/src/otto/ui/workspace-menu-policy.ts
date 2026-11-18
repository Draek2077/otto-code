/** Browser/automation management keeps its canonical entry points, outside New tab. */
export function showWorkspacePluginPanel(pluginId: string, panelId: string): boolean {
  if (pluginId === "otto-schedules" || pluginId === "otto-workflows") return false;
  return !(pluginId === "otto-browser" && panelId === "preview");
}
