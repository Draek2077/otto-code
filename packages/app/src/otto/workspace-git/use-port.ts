import { useMemo } from "react";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { createGitFetchPort } from "./port";

export function useGitFetchPort(serverId: string) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  // COMPAT(ottoGitFetch): added v0.10.0; remove after 2027-05-12 when host floor >= v0.10.0.
  const supported = useHostFeature(serverId, "ottoGitFetch");
  const port = useMemo(() => {
    if (!client || !connected || !supported) return null;
    return createGitFetchPort(serverId, (method, input, timeout) =>
      client.invokePluginRpc("otto-workspace-git", method, input, timeout),
    );
  }, [client, connected, supported, serverId]);
  return { port, connected };
}
