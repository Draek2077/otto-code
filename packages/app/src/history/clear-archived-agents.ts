import type { ConfirmDialogInput } from "@/utils/confirm-dialog";
import {
  resolveClearArchivedDialog,
  resolveClearArchivedEmptyDialog,
  resolveClearArchivedFailureDialog,
  resolveClearArchivedNoHostDialog,
} from "./delete-dialogs";

/** One host the sweep can run against. */
export interface ClearArchivedHost {
  serverId: string;
  clearArchivedAgents: (options: {
    dryRun: boolean;
    olderThanDays?: number;
    cleanupScope?: "otto" | "otto_and_provider";
  }) => Promise<{
    matched: number;
    deleted: number;
    failed: number;
    agentIds: string[];
    ottoBytes?: number;
    providerBytes?: number;
    reclaimedBytes?: number;
    unsupported?: number;
    stale?: number;
  }>;
}

export interface ClearArchivedInput {
  hosts: readonly ClearArchivedHost[];
  /** Whether the sweep was requested from the All hosts selection. */
  scope: "allHosts" | "oneHost";
  /** 0 (default) clears every archived chat. */
  olderThanDays?: number;
  cleanupScope?: "otto" | "otto_and_provider";
}

export interface ClearArchivedDeps {
  confirm: (input: ConfirmDialogInput) => Promise<boolean>;
  alert: (input: Omit<ConfirmDialogInput, "kind">) => Promise<void>;
  /** Called per host with the ids that host actually deleted. */
  onDeleted: (input: { serverId: string; agentIds: string[] }) => void;
  reportError: (error: unknown) => void;
}

export interface ClearArchivedOutcome {
  matched: number;
  deleted: number;
  failed: number;
  /** Hosts whose dry run failed, so they were never swept. */
  skippedHosts: string[];
  ottoBytes: number;
  providerBytes: number;
  reclaimedBytes: number;
  unsupported: number;
  stale: number;
}

/**
 * Bulk clear of archived chats across one or more hosts.
 *
 * Two passes on purpose. The first is a **dry run**, so the confirm dialog can
 * quote a real count instead of "some chats" - you cannot meaningfully consent to
 * an irreversible action whose size you were not told. The second pass deletes.
 *
 * A host whose dry run fails is **skipped entirely**, never swept blind: not
 * knowing how many a host would delete is exactly the case where "just send it"
 * is wrong. Its id comes back in `skippedHosts`.
 *
 * Returns `null` when nothing was destroyed - no matches, or the user cancelled.
 * Provider transcripts are never touched; see delete-dialogs.ts.
 */
export async function requestClearArchivedAgents(
  input: ClearArchivedInput,
  deps: ClearArchivedDeps,
): Promise<ClearArchivedOutcome | null> {
  if (input.hosts.length === 0) {
    // Not the same as "nothing matched": we never got to ask.
    await deps.alert(resolveClearArchivedNoHostDialog());
    return null;
  }

  const previews = await Promise.all(
    input.hosts.map(async (host) => {
      try {
        const payload = await host.clearArchivedAgents({
          dryRun: true,
          olderThanDays: input.olderThanDays,
          cleanupScope: input.cleanupScope,
        });
        return { host, payload, matched: payload.matched, ok: true as const };
      } catch (error) {
        deps.reportError(error);
        return { host, matched: 0, ok: false as const };
      }
    }),
  );

  const skippedHosts = previews.filter((p) => !p.ok).map((p) => p.host.serverId);
  const sweepable = previews.filter((preview) => preview.ok && preview.matched > 0);
  const matched = sweepable.reduce((total, preview) => total + preview.matched, 0);

  if (matched === 0) {
    // Nothing to destroy - don't put a destructive confirm in front of a no-op.
    await deps.alert(resolveClearArchivedEmptyDialog());
    return null;
  }

  const previewTotals = sweepable.reduce(
    (totals, preview) => ({
      ottoBytes: totals.ottoBytes + (preview.payload?.ottoBytes ?? 0),
      providerBytes: totals.providerBytes + (preview.payload?.providerBytes ?? 0),
    }),
    { ottoBytes: 0, providerBytes: 0 },
  );
  const confirmed = await deps.confirm(
    resolveClearArchivedDialog({
      matched,
      scope: input.scope,
      cleanupScope: input.cleanupScope,
      ...previewTotals,
    }),
  );
  if (!confirmed) {
    return null;
  }

  let deleted = 0;
  let failed = 0;
  let ottoBytes = 0;
  let providerBytes = 0;
  let reclaimedBytes = 0;
  let unsupported = 0;
  let stale = 0;
  for (const preview of sweepable) {
    try {
      const payload = await preview.host.clearArchivedAgents({
        dryRun: false,
        olderThanDays: input.olderThanDays,
        cleanupScope: input.cleanupScope,
      });
      deleted += payload.deleted;
      failed += payload.failed;
      ottoBytes += payload.ottoBytes ?? 0;
      providerBytes += payload.providerBytes ?? 0;
      reclaimedBytes += payload.reclaimedBytes ?? 0;
      unsupported += payload.unsupported ?? 0;
      stale += payload.stale ?? 0;
      if (payload.agentIds.length > 0) {
        deps.onDeleted({ serverId: preview.host.serverId, agentIds: payload.agentIds });
      }
    } catch (error) {
      // The request failed, so we cannot know how much of this host's batch
      // landed. Count its whole preview as failed rather than as deleted.
      failed += preview.matched;
      deps.reportError(error);
    }
  }

  if (failed > 0) {
    await deps.alert(resolveClearArchivedFailureDialog({ deleted, failed }));
  }

  return {
    matched,
    deleted,
    failed,
    skippedHosts,
    ottoBytes,
    providerBytes,
    reclaimedBytes,
    unsupported,
    stale,
  };
}
