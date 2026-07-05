import { useCallback, useState } from "react";
import type { MutableDaemonConfigPatch } from "@otto-code/protocol/messages";
import { ACP_PROVIDER_CATALOG, type AcpProviderCatalogEntry } from "@/data/acp-provider-catalog";

export type AcpProviderCatalogItem = AcpProviderCatalogEntry;

export function getAcpProviderCatalog(): AcpProviderCatalogItem[] {
  return ACP_PROVIDER_CATALOG;
}

export function buildAcpProviderConfigPatch(
  entry: AcpProviderCatalogItem,
): MutableDaemonConfigPatch {
  if (entry.extends === "acp" && !entry.command) {
    throw new Error(`Catalog entry '${entry.id}' extends "acp" but declares no command`);
  }
  return {
    providers: {
      [entry.id]: {
        extends: entry.extends,
        label: entry.title,
        description: entry.description,
        ...(entry.command ? { command: [...entry.command] } : {}),
        env: entry.env ? { ...entry.env } : {},
        ...(entry.params ? { params: { ...entry.params } } : {}),
        ...(entry.models ? { models: entry.models.map((model) => ({ ...model })) } : {}),
      },
    },
  };
}

export function useAcpProviderCatalog() {
  const [entries] = useState<AcpProviderCatalogItem[]>(ACP_PROVIDER_CATALOG);

  const refetch = useCallback(async () => entries, [entries]);

  return { entries, loading: false, error: null, refetch };
}
