import type { Logger } from "pino";

import {
  reclaimLegacyProviderImageDirs,
  sweepMaterializedProviderImages,
} from "./agent/providers/provider-image-output.js";

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/**
 * Keeps `$OTTO_HOME/attachments` - the images providers materialize so the
 * timeline has a file to point at - inside its retention policy.
 *
 * Runs once at startup and daily after that. A daemon left running for months
 * is the normal case on desktop, so start-only would mean the policy never
 * applied to the users who need it most. The timer is `unref`'d: housekeeping
 * is never a reason for the process to stay alive.
 *
 * Both passes are best-effort. Nothing here is load-bearing for serving a
 * request, so a failure is logged and the daemon comes up regardless.
 *
 * See docs/attachment-lifecycle.md.
 */
export interface MaterializedImageRetentionPolicy {
  maxAgeDays: number;
  maxTotalMb: number;
}

export function startMaterializedImageHousekeeping(options: {
  ottoHome: string;
  logger: Logger;
  /**
   * Read fresh on every pass, not captured once, so editing the setting takes
   * effect on the next sweep instead of at the next daemon restart.
   */
  getPolicy: () => MaterializedImageRetentionPolicy;
}): () => void {
  const { ottoHome, logger, getPolicy } = options;

  const runSweep = (): void => {
    try {
      const policy = getPolicy();
      const result = sweepMaterializedProviderImages({
        ottoHome,
        maxAgeMs: policy.maxAgeDays * 24 * 60 * 60 * 1_000,
        maxTotalBytes: policy.maxTotalMb * 1024 * 1024,
      });
      if (result.deleted > 0) {
        logger.info(
          { deleted: result.deleted, freedBytes: result.freedBytes },
          "Swept materialized provider images past retention",
        );
      }
    } catch (error) {
      logger.warn({ err: error }, "Failed to sweep materialized provider images");
    }
  };

  // One-shot: the retired layout scattered a temp directory per daemon start and
  // never removed any of them. Once a host is clean this finds nothing, so it
  // costs one readdir of the temp dir per daemon start.
  try {
    const reclaimed = reclaimLegacyProviderImageDirs();
    if (reclaimed.removed > 0) {
      logger.info(
        { removed: reclaimed.removed, skipped: reclaimed.skipped },
        "Removed legacy provider image temp directories",
      );
    }
  } catch (error) {
    logger.warn({ err: error }, "Failed to reclaim legacy provider image temp directories");
  }

  runSweep();

  const timer = setInterval(runSweep, SWEEP_INTERVAL_MS);
  timer.unref();

  return () => {
    clearInterval(timer);
  };
}
