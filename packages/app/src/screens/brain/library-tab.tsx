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
 * These run on the job RPCs, which shell out to the CLI. That is correct here
 * and stays: a download writes to this machine's model store. Only the reads
 * that a remote brain also needs moved to the proxied management API.
 */
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useQueryClient } from "@tanstack/react-query";
import type { BrainInventoryModel, BrainJob } from "@otto-code/protocol/messages";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import { Alert } from "@/components/ui/alert";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { nonCatalogHuggingFaceModels } from "./library-model-filter";
import { useBrainInventory } from "./use-brain-data";
import {
  CatalogList,
  DownloadedHuggingFaceModels,
  HuggingFaceSearch,
  type PinnedHuggingFaceModel,
  prependJob,
  useBrainCatalog,
  useBrainJobs,
  useRefreshOnJobCompletion,
} from "@/screens/settings/host-brain-models";

function huggingFaceRepo(model: BrainInventoryModel): string | null {
  const [owner, name, file] = model.id.split("/");
  return owner && name && file ? `${owner}/${name}` : null;
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
  const manageSupported = useHostFeature(serverId, "brainManage");
  const hfSupported = useHostFeature(serverId, "brainHfSearch");
  const queryClient = useQueryClient();
  const enabled = manageSupported && isConnected && (!isRemote || canWrite);

  const catalogQuery = useBrainCatalog(serverId, enabled);
  const jobsQuery = useBrainJobs(serverId, enabled);
  const inventoryQuery = useBrainInventory(serverId, enabled);
  const catalogModels = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);
  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);
  // The catalog owns some installed artifacts. Do not briefly render those in
  // Downloaded Models while its slower catalog read is still in flight, then
  // remove them a moment later.
  const catalogReady = catalogQuery.data !== undefined;
  const pinnedModels = useMemo<PinnedHuggingFaceModel[]>(
    () =>
      (catalogReady
        ? nonCatalogHuggingFaceModels(inventoryQuery.data?.models ?? [], catalogModels)
        : []
      )
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
    [catalogModels, catalogReady, inventoryQuery.data],
  );
  const client = useHostRuntimeClient(serverId);
  useRefreshOnJobCompletion(serverId, jobs);

  // Downloads are independent and may run together. Other operations still
  // reserve the Brain, so they gate starting or inspecting another operation.
  const busy = jobs.some((job) => job.status === "running" && job.kind !== "pull");

  const handleJobStarted = useCallback(
    (job: BrainJob) => {
      queryClient.setQueryData(["brain-jobs", serverId], (prev: BrainJob[] | undefined) =>
        prependJob(prev, job),
      );
    },
    [queryClient, serverId],
  );

  const handleJobCancel = useCallback(
    (jobId: string) => {
      if (!client) return;
      void client
        .brainJobsCancel(jobId)
        .then((nextJobs) => {
          queryClient.setQueryData(["brain-jobs", serverId], nextJobs);
          return nextJobs;
        })
        .catch((error) => {
          // Keep the running job visible if cancellation failed.
          console.error("Unable to cancel the download", error);
        });
    },
    [client, queryClient, serverId],
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

const styles = StyleSheet.create((theme) => ({
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
