import { useStyles } from "./styles";
import { useBrainView } from "../context";
import { useBrainOperations, useBrainHost } from "../context";

import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import type { BrainJob } from "../contracts/models";
import type { VarianceRow, LatestRun } from "../contracts/benchmark";

import { Alert } from "@/components/ui/alert";

import {
  ThemedSpinner,
  readRankings,
  readVariance,
  readLatestRuns,
  runBelongsTo,
  type RunListEntry,
  LeaderboardPanes,
} from "./views";
export function BrainBenchmarksTab({
  isConnected,
  canRunJobs,
}: {
  serverId: string;
  isConnected: boolean;
  /** False for a remote brain until it serves remote job operations. */
  canRunJobs: boolean;
}) {
  const styles = useStyles();
  const client = useBrainOperations();
  const manageSupported = useBrainHost().access.manage;
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null);

  const evalsQuery = useBrainView("evals", isConnected);

  // A bench run is a tracked job, so its progress comes from the job list rather
  // than from the evals read, which only changes once the run has finished.
  const jobsQuery = useBrainView("jobs", isConnected && manageSupported && canRunJobs);

  const evals = evalsQuery.data ?? null;
  const rankings = useMemo(() => readRankings(evals), [evals]);
  const variance = useMemo(() => readVariance(evals), [evals]);
  const latestRuns = useMemo(() => readLatestRuns(evals), [evals]);
  const runningBench = useMemo(
    () =>
      (jobsQuery.data ?? []).find(
        (job: BrainJob) => job.kind === "bench" && job.status === "running",
      ) ?? null,
    [jobsQuery.data],
  );

  const selected = useMemo(
    () => rankings.find((row) => row.id === selectedId) ?? null,
    [rankings, selectedId],
  );

  // The spread of every run sharing a run's model+config - the brain groups by
  // exactly this key (`ops/results.ts` `grouped()`), so the two sides line up.
  const spreadByKey = useMemo(() => {
    const map = new Map<string, VarianceRow>();
    for (const entry of variance) {
      if (entry.configKey) {
        map.set(`${entry.modelName}::${entry.configKey}`, entry);
      }
    }
    return map;
  }, [variance]);
  const spreadFor = useCallback(
    (run: LatestRun) =>
      run.configKey ? (spreadByKey.get(`${run.modelName}::${run.configKey}`) ?? null) : null,
    [spreadByKey],
  );

  // Newest first: a run list whose top row is the run the detail pane already
  // pins reads as one ordering rather than two.
  const runEntries = useMemo(() => {
    const scoped = selected ? latestRuns.filter((run) => runBelongsTo(run, selected)) : latestRuns;
    return scoped
      .map((run): RunListEntry => ({ run, spread: spreadFor(run) }))
      .sort((a, b) => (b.run.ranAt ?? "").localeCompare(a.run.ranAt ?? ""));
  }, [latestRuns, selected, spreadFor]);

  // The reference card. Newest by when it ran, not by what it scored: "latest"
  // has to mean the same thing here as it does in the run list beside it.
  const latest = runEntries[0] ?? null;
  const compared = useMemo(() => {
    if (!selectedRunKey || selectedRunKey === latest?.run.key) {
      return null;
    }
    return runEntries.find((entry) => entry.run.key === selectedRunKey) ?? null;
  }, [latest, runEntries, selectedRunKey]);

  const handleSelectModel = useCallback((id: string) => {
    setSelectedId(id);
    // A run of the model being left says nothing about the one being entered.
    setSelectedRunKey(null);
  }, []);

  const handleSelectRun = useCallback(
    (run: LatestRun) => {
      const owner = rankings.find((row) => runBelongsTo(run, row)) ?? null;
      // Picking a run from the unscoped list is also how a model gets picked.
      if (owner && owner.id !== selectedId) {
        setSelectedId(owner.id);
        setSelectedRunKey(run.key);
        return;
      }
      // Re-picking the compared run drops back to the latest run alone.
      setSelectedRunKey((previous) => (previous === run.key ? null : run.key));
    },
    [rankings, selectedId],
  );

  const handleRun = useCallback(() => {
    void (async () => {
      if (!client) {
        return;
      }
      setStarting(true);
      setStartError(null);
      try {
        await client.benchmark(null);
        await jobsQuery.refetch?.();
      } catch (err) {
        setStartError(err instanceof Error ? err.message : String(err));
      } finally {
        setStarting(false);
      }
    })();
  }, [client, jobsQuery]);

  const handleCancelBench = useCallback(() => {
    if (!client || !runningBench) {
      return;
    }
    setStartError(null);
    void client
      .cancelJob(runningBench.id)
      .catch((err) => setStartError(err instanceof Error ? err.message : String(err)));
  }, [client, runningBench]);

  const handleBack = useCallback(() => {
    setSelectedId(null);
    setSelectedRunKey(null);
  }, []);

  if (evalsQuery.isLoading && !evals) {
    return (
      <View style={styles.centered}>
        <ThemedSpinner size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {startError ? <Alert variant="error" description={startError} /> : null}
      <LeaderboardPanes
        runCount={evals?.runCount ?? 0}
        canRun={manageSupported && canRunJobs}
        starting={starting}
        running={runningBench !== null}
        runningJob={runningBench}
        onRun={handleRun}
        onCancelRunning={handleCancelBench}
        rows={rankings}
        runEntries={runEntries}
        selected={selected}
        latest={latest}
        compared={compared}
        selectedRunKey={selectedRunKey}
        spreadFor={spreadFor}
        onSelectModel={handleSelectModel}
        onSelectRun={handleSelectRun}
        onBack={handleBack}
      />
    </View>
  );
}
