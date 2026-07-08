import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

export const artifactContentQueryBaseKey = ["artifact-content"] as const;

export function artifactContentQueryKey(serverId: string, artifactId: string) {
  return [...artifactContentQueryBaseKey, serverId, artifactId] as const;
}

export interface UseArtifactContentResult {
  content: string | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetch an artifact's HTML content from a host and keep it fresh: the daemon
 * pushes `artifact.updated.notification` when generation completes or the file
 * changes, which invalidates the content query so the panel re-renders.
 */
export function useArtifactContent(serverId: string, artifactId: string): UseArtifactContentResult {
  const runtime = getHostRuntimeStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: artifactContentQueryKey(serverId, artifactId),
    queryFn: async (): Promise<string> => {
      const client = runtime.getClient(serverId);
      if (!client) {
        throw new Error(t("artifacts.errors.hostDisconnected"));
      }
      const payload = await client.artifactGetContent({ artifactId });
      if (!payload.success) {
        throw new Error(payload.error ?? "Failed to load artifact content");
      }
      return payload.content;
    },
  });

  useEffect(() => {
    const client = runtime.getClient(serverId);
    if (!client) {
      return;
    }
    const unsubscribe = client.on("artifact.updated.notification", (message) => {
      if (message.payload.artifact.id === artifactId) {
        void queryClient.invalidateQueries({
          queryKey: artifactContentQueryKey(serverId, artifactId),
        });
      }
    });
    return unsubscribe;
  }, [runtime, serverId, artifactId, queryClient]);

  return {
    content: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
