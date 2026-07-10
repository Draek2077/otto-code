import { useTranslation } from "react-i18next";
import { useFetchQuery } from "@/data/query";
import { i18n } from "@/i18n/i18next";

export const DIRECTORY_SEARCH_STALE_TIME = 15_000;
const DIRECTORY_SEARCH_LIMIT = 20;

export interface DirectorySearchClient {
  getDirectorySuggestions: (options: {
    cwd?: string;
    query: string;
    limit?: number;
    includeFiles?: boolean;
    includeDirectories?: boolean;
  }) => Promise<{
    directories: string[];
    entries?: Array<{ path: string; kind: "file" | "directory" }>;
    error: string | null;
  }>;
}

interface DirectorySearchQueryInput {
  client: DirectorySearchClient | null;
  serverId: string;
  cwd: string;
  query: string;
  enabled: boolean;
  hostDisconnectedMessage?: string;
}

export function directorySearchQueryKey(serverId: string, cwd: string, query: string) {
  return ["directory-search", serverId, cwd, query.trim()] as const;
}

export function buildDirectorySearchQueryOptions(input: DirectorySearchQueryInput) {
  const query = input.query.trim();

  return {
    queryKey: directorySearchQueryKey(input.serverId, input.cwd, query),
    queryFn: async (): Promise<string[]> => {
      if (!input.client) {
        throw new Error(
          input.hostDisconnectedMessage ?? i18n.t("workspace.terminal.hostDisconnected"),
        );
      }
      const response = await input.client.getDirectorySuggestions({
        cwd: input.cwd,
        query,
        limit: DIRECTORY_SEARCH_LIMIT,
        includeFiles: false,
        includeDirectories: true,
      });
      if (response.error) {
        throw new Error(response.error);
      }
      const entries = response.entries ?? [];
      if (entries.length > 0) {
        return entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path);
      }
      return response.directories;
    },
    dataShape: "list" as const,
    staleTimeMs: DIRECTORY_SEARCH_STALE_TIME,
    enabled: input.enabled && Boolean(input.client),
  };
}

export function useDirectorySearchQuery(input: DirectorySearchQueryInput) {
  const { t } = useTranslation();
  return useFetchQuery(
    buildDirectorySearchQueryOptions({
      ...input,
      hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
    }),
  );
}
