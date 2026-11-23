import { useCallback, useRef, useState } from "react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { useHostBrowserClient } from "./client";
import { useRevealBrowser } from "./reveal";
import { createHostedTab } from "./creation";
export function OpenHostBrowserMenuItem({
  serverId,
  workspaceId,
  url,
}: {
  serverId: string;
  workspaceId: string;
  url: string;
}) {
  const client = useHostBrowserClient(serverId, workspaceId),
    reveal = useRevealBrowser(serverId, workspaceId),
    toast = useToast();
  const [busy, setBusy] = useState(false),
    lock = useRef(false);
  const open = useCallback(() => {
    if (!client || lock.current) return;
    lock.current = true;
    setBusy(true);
    void (async () => {
      const result = await createHostedTab(client, serverId, url);
      await reveal(result.browserId);
    })()
      .catch(() => toast.error("This address could not be opened in Host Browser."))
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  }, [client, reveal, serverId, toast, url]);
  if (!client) return null;
  return (
    <DropdownMenuItem onSelect={open} disabled={busy}>
      Open in Host Browser
    </DropdownMenuItem>
  );
}
