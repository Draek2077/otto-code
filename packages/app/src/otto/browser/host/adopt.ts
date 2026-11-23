import type { HostBrowserTab } from "@getpaseo/plugin/otto/host-browser";
import { useBrowserStore } from "@/desktop/browser/store";
import { createBrowserRecord } from "@/desktop/browser/store/state";
import { hostBrowserBindings, retiredHostBrowsers } from "./ownership";
import { HostBrowserMetadataOrder } from "./metadata-order";
const metadataOrder = new HostBrowserMetadataOrder();

/** Persist positive host ownership before any canonical record can mount an Electron guest. */
export async function adoptHostBrowser(hostId: string, tab: HostBrowserTab) {
  if (retiredHostBrowsers.has(tab.browserId)) return false;
  if (
    useBrowserStore.getState().browsersById[tab.browserId] &&
    !(await hostBrowserBindings.read(tab.browserId))
  )
    throw new Error("An existing native browser cannot be replaced by a host tab.");
  await hostBrowserBindings.bind(tab.browserId, {
    version: 1,
    hostId,
    workspaceId: tab.workspaceId,
  });
  if (retiredHostBrowsers.has(tab.browserId)) return false;
  updateHostBrowser(tab);
  return true;
}
export function updateHostBrowser(tab: HostBrowserTab) {
  if (retiredHostBrowsers.has(tab.browserId) || !metadataOrder.accept(tab.browserId, tab.revision))
    return;
  useBrowserStore.setState((state) => {
    const existing = state.browsersById[tab.browserId];
    const record =
      existing ??
      createBrowserRecord({ browserId: tab.browserId, initialUrl: tab.url, now: Date.now() });
    if (
      existing &&
      existing.url === tab.url &&
      existing.title === tab.title &&
      existing.isLoading === tab.isLoading &&
      existing.canGoBack === tab.canGoBack &&
      existing.canGoForward === tab.canGoForward &&
      existing.lastError === tab.error
    )
      return state;
    return {
      browsersById: {
        ...state.browsersById,
        [tab.browserId]: {
          ...record,
          url: tab.url,
          title: tab.title,
          isLoading: tab.isLoading,
          canGoBack: tab.canGoBack,
          canGoForward: tab.canGoForward,
          lastError: tab.error,
        },
      },
    };
  });
}
