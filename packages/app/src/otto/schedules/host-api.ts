import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { createScheduleApi } from "./api";
import { createScheduleSources } from "./sources";
/** Resolve the current canonical client at invocation, including after reconnect.
 * This factory owns no connection, cache, timer or credential. */
export function bindScheduleHost(serverId: string) {
  const transport = {
    invokePluginRpc(plugin: string, method: string, input: unknown) {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) return Promise.reject(new Error("Owning Schedule host unavailable"));
      return client.invokePluginRpc(plugin, method, input);
    },
  };
  return { api: createScheduleApi(transport), sources: createScheduleSources(transport) };
}
