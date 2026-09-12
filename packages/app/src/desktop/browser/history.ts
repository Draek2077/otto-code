import { useSessionStore } from "@/stores/session-store";

export function getBrowserHistoryClient(serverId: string | null | undefined) {
  const session = serverId ? useSessionStore.getState().sessions[serverId] : null;
  // COMPAT(browserHistory): added in v0.9.7, remove gate after 2027-03-12.
  return session?.serverInfo?.features?.browserHistory === true ? session.client : null;
}

export function observeBrowserHistory(
  webview: HTMLElement,
  identity: { serverId?: string | null; workspaceId: string },
) {
  const guest = webview as HTMLElement & { getTitle?: () => string };
  let pendingUrl: string | null = null;
  const record = (url: string) => {
    if (url.length > 8192) return;
    const client = getBrowserHistoryClient(identity.serverId);
    if (!client) return;
    let title = "";
    try {
      title = guest.getTitle?.() ?? "";
    } catch {
      /* Guest may be detaching. */
    }
    void client
      .recordBrowserHistory(identity.workspaceId, url, title.slice(0, 512))
      .catch((error) => console.warn("[browser-history] Could not save visit", error));
  };
  // Completed main-frame navigations, including links, redirects and SPA history.
  // This listener lives as long as the resident guest, including background tabs.
  webview.addEventListener("did-navigate", (event) => {
    const url = (event as Event & { url?: string }).url;
    pendingUrl = url?.match(/^https?:\/\//i) ? url : null;
  });
  webview.addEventListener("dom-ready", () => {
    const url = pendingUrl;
    pendingUrl = null;
    if (url) record(url);
  });
  webview.addEventListener("did-navigate-in-page", (event) => {
    const navigation = event as Event & { url?: string; isMainFrame?: boolean };
    if (navigation.isMainFrame !== false && navigation.url?.match(/^https?:\/\//i))
      record(navigation.url);
  });
}
