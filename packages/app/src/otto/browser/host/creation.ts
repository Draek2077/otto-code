import { useCallback, useEffect, useRef } from "react";
import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser, normalizeWorkspaceBrowserUrl } from "@/desktop/browser/store";
import { useToast } from "@/contexts/toast-context";
import { useHostBrowserClient, type HostBrowserClient } from "./client";
import { adoptHostBrowser } from "./adopt";

export async function createHostedTab(client: HostBrowserClient, serverId: string, url: string) {
  const result = await client.command({
    command: "new_tab",
    args: { url: normalizeWorkspaceBrowserUrl(url) },
  });
  if (result.command !== "new_tab") throw new Error("The host returned another browser operation.");
  const tab = (await client.list()).find((candidate) => candidate.browserId === result.browserId);
  if (!tab) throw new Error("The host browser tab was not found in its workspace.");
  if (!(await adoptHostBrowser(serverId, tab)))
    throw new Error("The host browser was closed while opening.");
  return { browserId: result.browserId, url: tab.url };
}
/** Desktop keeps Paseo's native creation. Other clients use the selected host's explicit capability. */
export function useBrowserCreation(serverId: string, workspaceId: string, focused: boolean) {
  const client = useHostBrowserClient(serverId, workspaceId),
    toast = useToast();
  const owner = useRef<object | null>(null);
  useEffect(() => {
    if (!focused) return;
    const token = {};
    owner.current = token;
    return () => {
      if (owner.current === token) owner.current = null;
    };
  }, [focused, serverId, workspaceId]);
  const create = useCallback(
    async (url = "https://example.com") => {
      if (getIsElectron()) return createWorkspaceBrowser({ initialUrl: url });
      const token = owner.current;
      if (!token || !client) return null;
      try {
        const result = await createHostedTab(client, serverId, url);
        return owner.current === token ? result : null;
      } catch {
        if (owner.current === token)
          toast.error(
            "The host could not open this browser. Check its browser runtime and connection.",
          );
        return null;
      }
    },
    [client, serverId, toast],
  );
  return { available: getIsElectron() || client !== null, create };
}
