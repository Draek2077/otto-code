import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

export function useArtifactData(serverId: string, artifactId: string, enabled: boolean) {
  const runtime = getHostRuntimeStore();
  return useFetchQuery({
    queryKey: ["artifact-data", serverId, artifactId],
    enabled,
    dataShape: "value",
    staleTimeMs: 0,
    queryFn: async (): Promise<unknown | null> => {
      const client = runtime.getClient(serverId);
      if (!client) throw new Error("Host is disconnected");
      const payload = await client.artifactGetData({ artifactId });
      if (!payload.success) throw new Error(payload.error ?? "Failed to load artifact data");
      return payload.data;
    },
  });
}
