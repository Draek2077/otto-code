/**
 * Queries and formatting shared by the Brain page's tabs.
 *
 * Everything here goes through the daemon's proxied `/__host/*` RPCs, which
 * resolve to a local child or a remote brain identically. No tab needs to know
 * which it is talking to; `capabilities` on the status says what the far side
 * can do, and that is the only branch.
 */
import { useMemo } from "react";
import { brainStatusQueryKey, PUSHED_BRAIN_STATUS_STALE_MS } from "@/data/brain-status";
import { useFetchQuery } from "@/data/query";
import type { BrainCapabilities, BrainHostStatus } from "@otto-code/protocol/messages";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

/** How often the Overview tab refreshes while it is on screen. */
const STATUS_POLL_MS = 2000;
/** The inventory is a disk walk; it refreshes on demand, not on a timer. */
const INVENTORY_STALE_MS = 30_000;
const LOGS_POLL_MS = 3000;

// The cache key lives in the data layer because the push router writes it; this
// re-export keeps the Brain page's own imports pointed at one place.
export { brainStatusQueryKey };

export function brainInventoryQueryKey(serverId: string) {
  return ["brain-console-inventory", serverId] as const;
}

export function brainLogsQueryKey(serverId: string) {
  return ["brain-console-logs", serverId] as const;
}

/**
 * The brain's status, optionally with live resource telemetry.
 *
 * `resources` is part of the query key on purpose: the two variants return
 * different shapes and are wanted by different tabs, and sharing one cache entry
 * would let the Models tab's cheap poll overwrite the Overview tab's readings
 * with a payload that has no `resources` at all.
 */
export function useBrainStatus(
  serverId: string,
  options: { enabled: boolean; resources?: boolean },
) {
  const client = useHostRuntimeClient(serverId);
  const resources = options.resources ?? false;
  // The one gate, at the query boundary rather than scattered through the tabs:
  // a daemon that pushes cheap status owns this cache entry, so polling it as
  // well would only be a slower second opinion. The `resources` variant is
  // never pushed (it spawns `nvidia-smi`), so it keeps its poll either way.
  const pushed = useHostFeature(serverId, "brainStatusPush") && !resources;
  return useFetchQuery({
    queryKey: brainStatusQueryKey(serverId, resources),
    enabled: options.enabled && Boolean(client),
    dataShape: "value",
    staleTimeMs: pushed ? PUSHED_BRAIN_STATUS_STALE_MS : STATUS_POLL_MS,
    refetchInterval: pushed ? false : STATUS_POLL_MS,
    queryFn: async () => {
      if (!client) {
        throw new Error("This host is not connected.");
      }
      return client.brainHostStatus({ resources });
    },
  });
}

export function useBrainInventory(serverId: string, enabled: boolean) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: brainInventoryQueryKey(serverId),
    enabled: enabled && Boolean(client),
    dataShape: "value",
    staleTimeMs: INVENTORY_STALE_MS,
    queryFn: async () => {
      if (!client) {
        throw new Error("This host is not connected.");
      }
      return client.brainModelsInventory();
    },
  });
}

export function useBrainLogs(serverId: string, enabled: boolean) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: brainLogsQueryKey(serverId),
    enabled: enabled && Boolean(client),
    dataShape: "value",
    staleTimeMs: LOGS_POLL_MS,
    refetchInterval: LOGS_POLL_MS,
    queryFn: async () => {
      if (!client) {
        throw new Error("This host is not connected.");
      }
      return client.brainLogsTail(500);
    },
  });
}

/**
 * What the brain on the far side can serve. A brain that predates the management
 * API reports nothing, and every capability reads false, which is what makes the
 * tabs say "update the brain" instead of failing a request per render.
 */
export function useBrainCapabilities(status: BrainHostStatus | null): BrainCapabilities | null {
  return useMemo(() => status?.capabilities ?? null, [status]);
}

// --- Formatting -------------------------------------------------------------
// Byte quantities stay raw across the wire and are formatted only here, matching
// the brain package's own convention.

const GIB = 1024 ** 3;

export function formatGiB(bytes: number | null | undefined, digits = 1): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) {
    return "unknown";
  }
  return `${(bytes / GIB).toFixed(digits)} GB`;
}

export function formatCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "unknown";
}

export function formatPercent(fraction: number | null | undefined, digits = 0): string {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) {
    return "unknown";
  }
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** A benchmark score as the TUI shows it: a whole percentage, or an em space. */
export function formatScore(overall: number | null | undefined): string {
  return typeof overall === "number" && Number.isFinite(overall)
    ? `${Math.round(overall * 100)}%`
    : "–";
}

/**
 * The colour band for a benchmark score, matching the TUI's four thresholds
 * (`scoreColour()`) so a model that read as "good" in the terminal reads the
 * same here: >=0.75 good, >=0.55 fair, >=0.35 poor, else bad.
 */
export function scoreBand(
  overall: number | null | undefined,
): "good" | "fair" | "poor" | "bad" | "none" {
  if (typeof overall !== "number" || !Number.isFinite(overall)) {
    return "none";
  }
  if (overall >= 0.75) {
    return "good";
  }
  if (overall >= 0.55) {
    return "fair";
  }
  if (overall >= 0.35) {
    return "poor";
  }
  return "bad";
}

/**
 * How the calibration state reads in the UI. `inherited` is deliberately not
 * called "measured": it came from a relative with the same attention geometry,
 * rescaled to this model's layer count.
 */
export function calibrationLabel(state: string | null | undefined): string {
  switch (state) {
    case "measured":
      return "Measured";
    case "inherited":
      return "Measured on a relative";
    case "stale":
      return "Stale, recalibrate";
    case "theoretical":
      return "Estimated";
    default:
      return "Unknown";
  }
}
