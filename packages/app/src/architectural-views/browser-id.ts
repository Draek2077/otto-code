/**
 * The preview beside an Interactive View authoring chat is a browser-automation
 * target, not an independently closeable workspace tab. Keep its identity
 * deterministic so the workspace close path can unregister exactly that guest.
 */
export function architecturalViewAuthoringBrowserId(agentId: string): string {
  return `architectural-view-${agentId}`;
}
