/**
 * The Library tab: getting models onto this host.
 *
 * This is the TUI's Hugging Face search (`f`), quant picker (`g`) and rescan
 * (`r`), plus the progress of whatever is downloading. Runtime installation
 * moved to the Overview tab - it is host status, not a way to get a model.
 *
 * It composes the pieces that already existed inside Settings rather than
 * reimplementing them: `CatalogList` and `HuggingFaceSearch` were already
 * separate components, they were just wrapped in a settings card. The
 * installed-model list that sat alongside them deliberately does NOT come
 * along, because that is the Models tab's job now and two lists of the same
 * models on one page is how they drift.
 *
 * Search sits above the catalog: it is what most people reach for first, and
 * the catalog underneath is the fallback for "just pick something good."
 * Download progress rides inline on the row that started it (see
 * `InlineJobProgress` in `host-brain-models.tsx`) - there is no separate
 * jobs panel here to fall out of sync with those rows.
 *
 * These run on the job RPCs, which shell out to the CLI. That is correct here
 * and stays: a download writes to this machine's model store. Only the reads
 * that a remote brain also needs moved to the proxied management API.
 */
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useQueryClient } from "@tanstack/react-query";
import type { BrainJob } from "@otto-code/protocol/messages";
import { Alert } from "@/components/ui/alert";
import { useHostFeature } from "@/runtime/host-features";
import {
  CatalogList,
  HuggingFaceSearch,
  prependJob,
  useBrainCatalog,
  useBrainJobs,
  useRefreshOnJobCompletion,
} from "@/screens/settings/host-brain-models";

export function BrainLibraryTab({
  serverId,
  isConnected,
  isRemote,
}: {
  serverId: string;
  isConnected: boolean;
  /** A remote brain's model store belongs to the machine that hosts it. */
  isRemote: boolean;
}) {
  const manageSupported = useHostFeature(serverId, "brainManage");
  const hfSupported = useHostFeature(serverId, "brainHfSearch");
  const queryClient = useQueryClient();
  const enabled = manageSupported && isConnected && !isRemote;

  const catalogQuery = useBrainCatalog(serverId, enabled);
  const jobsQuery = useBrainJobs(serverId, enabled);

  const catalogModels = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);
  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);
  useRefreshOnJobCompletion(serverId, jobs);

  // One job at a time on the brain side, so anything running gates the rest.
  const busy = jobs.some((job) => job.status === "running");

  const handleJobStarted = useCallback(
    (job: BrainJob) => {
      queryClient.setQueryData(["brain-jobs", serverId], (prev: BrainJob[] | undefined) =>
        prependJob(prev, job),
      );
    },
    [queryClient, serverId],
  );

  if (isRemote) {
    return (
      <Alert
        variant="info"
        title="This brain runs on another machine"
        description="Download models on the host that runs it. Its model store is its own."
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
    <View style={styles.container}>
      {hfSupported ? (
        <View style={styles.card}>
          <HuggingFaceSearch
            serverId={serverId}
            busy={busy}
            jobs={jobs}
            onStarted={handleJobStarted}
          />
        </View>
      ) : (
        <Alert variant="info" description="Update the host to search Hugging Face from here." />
      )}
      <View style={styles.card}>
        <CatalogList
          serverId={serverId}
          models={catalogModels}
          loading={catalogQuery.isLoading}
          busy={busy}
          jobs={jobs}
          onStarted={handleJobStarted}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[6],
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
