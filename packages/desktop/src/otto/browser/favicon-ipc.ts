import {
  buildBrowserFaviconCandidates,
  createBrowserFaviconResolver,
  readBrowserFaviconRequest,
  type BrowserFaviconFetch,
} from "./favicon.js";
export interface FaviconSender {
  sender: { id: number; mainFrame: unknown };
  senderFrame?: unknown;
}
/** The bridge is available only to the owning app frame, never a guest iframe. */
export function createBrowserFaviconHandler(ports: {
  trusted(event: FaviconSender): boolean;
  fetchForBrowser(browserId: string, hostWebContentsId: number): BrowserFaviconFetch;
}) {
  const resolver = createBrowserFaviconResolver();
  return {
    clear: () => resolver.clear(),
    async resolve(event: FaviconSender, raw: unknown): Promise<string | null> {
      if (!ports.trusted(event)) return null;
      const input = readBrowserFaviconRequest(raw);
      if (!input) return null;
      const candidates = buildBrowserFaviconCandidates(input);
      if (!candidates.length) return null;
      return resolver.resolve({
        candidates,
        fetch: ports.fetchForBrowser(input.browserId, event.sender.id),
      });
    },
  };
}
