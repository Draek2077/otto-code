/** Shared CLI progress and activity reporting for Hugging Face repo downloads. */
import {
  downloadRepoFiles,
  type DownloadFilesOptions,
  type PullProgress,
} from "../models/index.js";
import { withActivity } from "../service/activity.js";

export interface RepoDownloadOptions extends DownloadFilesOptions {
  activityTarget: string;
  progressLabel: string;
  totalBytes: number | null;
}

/**
 * Download a repo selection while keeping the daemon job ring and host-status
 * activity record in lockstep. Repository size metadata is advisory, so a
 * successful transfer is the only authoritative completion signal.
 */
export async function downloadRepoFilesWithProgress({
  activityTarget,
  progressLabel,
  totalBytes,
  ...options
}: RepoDownloadOptions): Promise<string[]> {
  let lastPct = -1;
  const written = await withActivity("download", { target: activityTarget }, (activity) =>
    downloadRepoFiles({
      ...options,
      onProgress: (progress: PullProgress) => {
        activity.update(totalBytes ? progress.receivedBytes / totalBytes : null);
        const pct = totalBytes ? Math.floor((progress.receivedBytes / totalBytes) * 100) : 0;
        // A download chunk can jump straight over a five-percent boundary.
        // Report each new integer percent so the UI ring never stalls until
        // completion simply because no chunk hit an exact multiple of five.
        if (pct > lastPct) {
          lastPct = pct;
          process.stderr.write(`  ${progressLabel}: ${pct}%\r`);
        }
      },
    }),
  );
  process.stderr.write(`  ${progressLabel}: 100%\r`);
  process.stderr.write("\n");
  return written;
}
