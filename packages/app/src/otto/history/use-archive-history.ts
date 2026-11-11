import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import type { HostPickerHost } from "@/components/hosts/host-picker";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker-constants";
import { useToast } from "@/contexts/toast-context";
import { agentHistoryQueryKey, allAgentHistoryQueryRootKey } from "@/hooks/agent-history-query-key";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  clearArchivedHistory,
  formatArchiveBytes,
  type ArchiveCleanupOutcome,
  type ArchiveTarget,
} from "./archive-cleanup";

const archiveSummaryKey = ["otto", "archiveSummary"] as const;
type HostSupport = Record<string, boolean>;
type HostSnapshot = ReturnType<ReturnType<typeof getHostRuntimeStore>["getSnapshot"]>;

function makeTarget(host: HostPickerHost, snapshot: HostSnapshot): ArchiveTarget | null {
  if (!isHostRuntimeConnected(snapshot) || !snapshot?.client) return null;
  const { client, connectionEpoch } = snapshot;
  return {
    id: host.serverId,
    label: host.label,
    client,
    isCurrent: () => {
      const now = getHostRuntimeStore().getSnapshot(host.serverId);
      return (
        now?.connectionStatus === "online" &&
        now.client === client &&
        now.connectionEpoch === connectionEpoch
      );
    },
  };
}

function useHostArchiveSupport(hosts: readonly HostPickerHost[]): HostSupport {
  return useSessionStore(
    useShallow(
      (state): HostSupport =>
        Object.fromEntries(
          // COMPAT(historyArchiveCleanup): added in v0.10.0; remove after 2027-05-10.
          hosts.map(({ serverId }) => [
            serverId,
            state.sessions[serverId]?.serverInfo?.features?.historyArchiveCleanup === true,
          ]),
        ),
    ),
  );
}

export function useArchiveTargets(hosts: readonly HostPickerHost[], serverId: string | null) {
  const runtime = getHostRuntimeStore();
  const subscribe = useCallback((fn: () => void) => runtime.subscribeAll(fn), [runtime]);
  const getVersion = useCallback(() => runtime.getVersion(), [runtime]);
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);
  const support = useHostArchiveSupport(hosts);
  return useMemo(() => {
    void version;
    const eligible = [];
    const selected = [];
    const excluded: string[] = [];
    let canReview = false;
    let canFilter = true;
    for (const host of hosts) {
      const inScope = !serverId || host.serverId === serverId;
      const snapshot = runtime.getSnapshot(host.serverId);
      const supported = support[host.serverId] === true;
      const target = supported ? makeTarget(host, snapshot) : null;
      if (target) eligible.push(target);
      if (!inScope) continue;
      if (supported) canReview = true;
      if (!supported && isHostRuntimeConnected(snapshot)) canFilter = false;
      if (target) selected.push(target);
      else excluded.push(host.label);
    }
    return { eligible, selected, excluded, canReview, canFilter: canReview && canFilter };
  }, [hosts, runtime, serverId, support, version]);
}

async function describeArchives(targets: readonly ArchiveTarget[], hostCount: number) {
  const result: Record<string, string> = {};
  let total = 0;
  let complete = targets.length === hostCount && hostCount > 0;
  await Promise.all(
    targets.map(async (target) => {
      try {
        const { summary } = await target.client.getArchiveSummary();
        if (!target.isCurrent()) {
          complete = false;
          return;
        }
        const size = formatArchiveBytes(summary.bytes);
        result[target.id] = summary.unavailable ? `${size} reviewable · incomplete` : size;
        total += summary.bytes;
        if (summary.unavailable) complete = false;
      } catch {
        complete = false;
      }
    }),
  );
  if (complete) result[ALL_HOSTS_OPTION_ID] = formatArchiveBytes(total);
  return result;
}

export function useArchiveDescriptions(
  targets: readonly ArchiveTarget[],
  hostCount: number,
  open: boolean,
) {
  return useFetchQuery({
    queryKey: [...archiveSummaryKey, targets.map((target) => target.id), hostCount],
    queryFn: () => describeArchives(targets, hostCount),
    enabled: open && targets.length > 0,
    retry: false,
    refetchOnWindowFocus: false,
    staleTimeMs: 15_000,
    dataShape: "value",
  }).data;
}

function summarizeCleanup(outcome: Exclude<ArchiveCleanupOutcome, { status: "cancelled" }>) {
  const extra = [
    outcome.unavailable ? `${outcome.unavailable} records could not be reviewed.` : "",
    outcome.skipped.length ? `Hosts skipped: ${outcome.skipped.join(", ")}.` : "",
  ];
  if (outcome.status === "empty") {
    const message =
      outcome.skipped.length || outcome.unavailable
        ? "No reviewable archive records were found."
        : "There are no archived chats to clear.";
    return [message, ...extra].filter(Boolean).join(" ");
  }
  return [
    `Cleared ${outcome.deleted} archived records (${formatArchiveBytes(outcome.reclaimedBytes)}).`,
    outcome.changed ? `${outcome.changed} need a new review.` : "",
    outcome.failed ? `${outcome.failed} could not be removed.` : "",
    outcome.retainedTimelines
      ? `${outcome.retainedTimelines} Otto timelines could not be reclaimed.`
      : "",
    outcome.uncertain.length
      ? `Outcome unknown on ${outcome.uncertain.join(", ")}. Refresh before reviewing again.`
      : "",
    ...extra,
  ]
    .filter(Boolean)
    .join(" ");
}

export function useClearArchive({
  serverId,
  targets,
  excluded,
}: {
  serverId: string | null;
  targets: readonly ArchiveTarget[];
  excluded: readonly string[];
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const operation = useRef<{ active: AbortController | null }>({ active: null });
  const cancel = useCallback(() => operation.current.active?.abort(), []);
  useLayoutEffect(() => cancel, [cancel, serverId]);

  const clear = useCallback(() => {
    if (operation.current.active) return;
    const controller = new AbortController();
    operation.current.active = controller;
    setBusy(true);
    void clearArchivedHistory({
      targets,
      excludedHostLabels: excluded,
      signal: controller.signal,
      confirm: confirmDialog,
    })
      .then((outcome) => {
        if (outcome.status === "cancelled") return;
        if (outcome.status === "finished") {
          for (const id of outcome.attemptedHostIds) {
            void queryClient.invalidateQueries({ queryKey: agentHistoryQueryKey(id) });
          }
          void queryClient.invalidateQueries({ queryKey: allAgentHistoryQueryRootKey() });
          void queryClient.invalidateQueries({ queryKey: archiveSummaryKey });
        }
        if (!controller.signal.aborted || outcome.status === "finished") {
          toast.show(summarizeCleanup(outcome), { durationMs: 7000 });
        }
        return undefined;
      })
      .catch(() => {
        toast.error("Archive cleanup could not finish.");
      })
      .finally(() => {
        operation.current.active = null;
        setBusy(false);
      });
  }, [excluded, queryClient, targets, toast]);

  return { clear, busy, cancel };
}
