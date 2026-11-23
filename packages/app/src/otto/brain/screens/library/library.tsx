import { useBrainOperations, useBrainHost } from "../context";
/**
 * The Library tab: getting models onto this host.
 *
 * This is the TUI's Hugging Face search (`f`), quant picker (`g`) and rescan
 * (`r`), plus the progress of whatever is downloading. Runtime installation
 * moved to the Overview tab - it is host status, not a way to get a model.
 *
 * It composes the pieces that already existed inside Settings rather than
 * reimplementing them: `CatalogList` and `HuggingFaceSearch` were already
 * separate components, they were just wrapped in a settings card. Search
 * results retain their quant picker after a download, so that same row is the
 * place to download another quant or delete the installed one. The Models tab
 * remains the detail and tuning surface.
 *
 * Search sits above the catalog: it is what most people reach for first, and
 * the catalog underneath is the fallback for "just pick something good."
 * The catalog stays complete, including models already installed. It is the
 * permanent recommendation list, while Hugging Face rows are the place to
 * manage a searched repository's individual quantizations.
 *
 */
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { createBrainStyles } from "../theme";
import type { BrainInventoryModel } from "../contracts/models";
import { ChatWidthBounds } from "../ui/content-width";
import { Alert } from "@/components/ui/alert";
import { nonCatalogHuggingFaceModels } from "./model-filter";
import { useBrainInventory } from "../data";

import { CatalogList } from "./catalog";
import { DownloadedHuggingFaceModels, HuggingFaceSearch } from "./widgets";
import { type PinnedHuggingFaceModel } from "./quant-picker";

import { useBrainCatalog, useBrainJobs } from "../data";

function huggingFaceRepo(model: BrainInventoryModel): string | null {
  return model.repo;
}

export function BrainLibraryTab({
  serverId,
  isConnected,
  isRemote,
  canWrite,
}: {
  serverId: string;
  isConnected: boolean;
  /** A remote brain's model store belongs to the machine that hosts it. */
  isRemote: boolean;
  /** The remote brain's live allowRemoteConfig capability. */
  canWrite: boolean;
}) {
  const styles = useStyles();
  const [operationError, setOperationError] = useState<string | null>(null);
  const manageSupported = useBrainHost().access.manage;
  const hfSupported = useBrainHost().access.hfSearch;
  const enabled = manageSupported && isConnected && (!isRemote || canWrite);

  const catalogQuery = useBrainCatalog(enabled);
  const jobsQuery = useBrainJobs(enabled);
  const inventoryQuery = useBrainInventory(enabled);
  const catalogModels = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);
  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);
  // The catalog owns some installed artifacts. Do not briefly render those in
  // Downloaded Models while its slower catalog read is still in flight, then
  // remove them a moment later.
  const catalogReady = catalogQuery.data !== undefined;
  const pinnedModels = useMemo<PinnedHuggingFaceModel[]>(
    () =>
      (catalogReady ? nonCatalogHuggingFaceModels(inventoryQuery.data?.models ?? []) : [])
        .map((model) => ({
          id: model.id,
          name: model.displayName,
          repo: huggingFaceRepo(model),
          quant: model.quant,
          sizeBytes: model.sizeBytes,
          hasProjector: model.hasProjector,
        }))
        // A disk walk is not a user-facing order. Keep this management list
        // stable when a sibling quant is removed or a scan completes.
        .sort((a, b) => a.id.localeCompare(b.id)),
    [catalogReady, inventoryQuery.data],
  );
  const client = useBrainOperations();

  // Downloads are independent and may run together. Other operations still
  // reserve the Brain, so they gate starting or inspecting another operation.
  const busy = jobs.some((job) => job.status === "running" && job.kind !== "pull");

  const handleJobStarted = useBrainOperations().observeJob;

  const handleJobCancel = useCallback(
    (jobId: string) => {
      if (!client) return;
      setOperationError(null);
      void client
        .cancelJob(jobId)
        .then((nextJobs) => {
          client.observeJobs(nextJobs);
          return nextJobs;
        })
        .catch((error) => {
          // Keep the running job visible if cancellation failed.
          setOperationError(error instanceof Error ? error.message : String(error));
        });
    },
    [client],
  );

  if (isRemote && !canWrite) {
    // The screen normally removes this tab before it can render. Keep this
    // boundary for a capability change between the toolbar render and this tab.
    return (
      <Alert
        variant="info"
        title="Remote configuration is disabled"
        description="This host has not allowed remote model changes."
      />
    );
  }

  if (!manageSupported) {
    return (
      <Alert
        variant="info"
        title="Update the host"
        description="This host's daemon cannot manage the brain's models. Update it to use this tab."
      />
    );
  }

  return (
    <ChatWidthBounds style={styles.catalogBounds}>
      <View style={styles.container}>
        {operationError ? <Alert variant="error" description={operationError} /> : null}
        {hfSupported ? (
          <View style={styles.card}>
            <HuggingFaceSearch
              serverId={serverId}
              busy={busy}
              jobs={jobs}
              onStarted={handleJobStarted}
              onCancel={handleJobCancel}
            />
          </View>
        ) : (
          <Alert variant="info" description="Update the host to search Hugging Face from here." />
        )}
        {pinnedModels.length > 0 ? (
          <View style={styles.card}>
            <DownloadedHuggingFaceModels
              serverId={serverId}
              models={pinnedModels}
              busy={busy}
              jobs={jobs}
              onStarted={handleJobStarted}
              onCancel={handleJobCancel}
            />
          </View>
        ) : null}
        <View style={styles.card}>
          <CatalogList
            serverId={serverId}
            models={catalogModels}
            loading={catalogQuery.isLoading}
            busy={busy}
            jobs={jobs}
            onStarted={handleJobStarted}
            onCancel={handleJobCancel}
          />
        </View>
      </View>
    </ChatWidthBounds>
  );
}

const useStyles = createBrainStyles((theme) => ({
  container: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[6],
  },
  // Match the Metrics usage ledger: the whole Library tab respects the user's
  // selected chat width on wide panes.
  catalogBounds: {
    width: "100%",
    alignSelf: "center",
  },
  card: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    // surface1, not surface2: see the same fix in models-tab.tsx's `table` -
    // surface2 and the border token are nearly identical on this theme.
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
}));
