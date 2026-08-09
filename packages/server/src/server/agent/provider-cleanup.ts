import type { ProviderCleanupManifest } from "@otto-code/protocol/agent-types";
import type { AgentPersistenceHandle } from "./agent-sdk-types.js";

/** Safe default for ACP, remote, and every provider without a native adapter. */
export function unsupportedProviderCleanupManifest(
  provider: string,
  persistence: AgentPersistenceHandle | null,
): ProviderCleanupManifest {
  return {
    capability: "unsupported",
    provider,
    sessionId: persistence?.sessionId ?? "",
    entries: [],
    providerBytes: 0,
    validationToken: "unsupported",
  };
}

/** Adapters must prove every resource is uniquely owned before deletion. */
export function isProviderCleanupManifestSafe(manifest: ProviderCleanupManifest): boolean {
  return (
    manifest.capability === "supported" &&
    manifest.validationToken.length > 0 &&
    manifest.entries.every(
      (entry) =>
        entry.owner === "provider" &&
        entry.referenceCount === 1 &&
        entry.bytes >= 0 &&
        entry.validationToken.length > 0,
    )
  );
}
