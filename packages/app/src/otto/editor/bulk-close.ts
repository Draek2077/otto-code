import { getPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
/** A bulk layout removal must still consult owners of external buffers. This
 * runs after the existing aggregate confirmation, before any tab is removed. */
export async function prepareEditorBulkClose(
  scope: { serverId: string; workspaceId: string },
  tabs: readonly { tabId: string }[],
) {
  for (const tab of tabs) {
    const owner = getPanelInstanceAttributes({ ...scope, tabId: tab.tabId }).beforeClose;
    if (owner && !(await owner())) return false;
  }
  return true;
}
