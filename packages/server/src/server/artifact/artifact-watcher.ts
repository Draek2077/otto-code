import { readFileSync, watch as fsWatch, writeFileSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { dirname } from "node:path";
import type { Logger } from "pino";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { validateHtmlFile } from "./html-validator.js";
import type { ArtifactStore } from "./artifact-store.js";

const BATCH_POLL_INTERVAL_MS = 1000;

interface ArtifactWatcherOptions {
  store: ArtifactStore;
  logger: Logger;
  sendNotification: (metadata: ArtifactMetadata) => void;
  // How long to wait for a valid artifact file before giving up. The service
  // owns this value (env-tunable) so the timeout and its user-facing message
  // stay in one place.
  timeoutMs: number;
  // Invoked when a generation exceeds timeoutMs. The watcher can only touch the
  // store; the service owns the generation agent, so it performs the real
  // teardown (cancel the run so no agent lingers, then mark the artifact).
  onTimeout: (artifactId: string) => void;
}

interface WatchHandle {
  watcher: FSWatcher | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

export class ArtifactWatcher {
  private readonly store: ArtifactStore;
  private readonly logger: Logger;
  private readonly sendNotification: (metadata: ArtifactMetadata) => void;
  private readonly timeoutMs: number;
  private readonly onTimeout: (artifactId: string) => void;
  private readonly activeWatchers: Map<string, string> = new Map();
  private readonly handles: Map<string, WatchHandle> = new Map();
  private batchPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ArtifactWatcherOptions) {
    this.store = options.store;
    this.logger = options.logger.child({ module: "artifact-watcher" });
    this.sendNotification = options.sendNotification;
    this.timeoutMs = options.timeoutMs;
    this.onTimeout = options.onTimeout;
  }

  watch(artifactId: string, filePath: string): void {
    if (this.handles.has(artifactId)) {
      return;
    }

    const handle: WatchHandle = { watcher: null, timeoutTimer: null };
    this.handles.set(artifactId, handle);

    const validation = validateHtmlFile(filePath);
    if (validation.isValid) {
      this.writeSanitizedContent(filePath, validation.content);
      this.updateToReady(artifactId);
      return;
    }

    const artifactsDir = dirname(filePath);

    try {
      handle.watcher = fsWatch(artifactsDir, { persistent: false }, () => {
        this.checkFileReady(artifactId, filePath);
      });
      this.logger.debug(
        { artifactId, dir: artifactsDir },
        "Started fs.watch on artifacts directory",
      );
    } catch (error) {
      this.logger.warn(
        { error, artifactId },
        "Failed to set up fs.watch, relying on polling fallback",
      );
      handle.watcher = null;
    }

    this.activeWatchers.set(artifactId, filePath);
    this.startBatchPolling();

    handle.timeoutTimer = setTimeout(() => {
      this.handleTimeout(artifactId);
    }, this.timeoutMs);
    handle.timeoutTimer?.unref?.();

    this.logger.debug({ artifactId, filePath }, "Watching for artifact file creation");
  }

  unwatch(artifactId: string): void {
    const handle = this.handles.get(artifactId);
    if (!handle) return;

    this.activeWatchers.delete(artifactId);

    if (this.activeWatchers.size === 0) {
      this.stopBatchPolling();
    }

    this.cleanupHandle(handle);
    this.handles.delete(artifactId);
    this.logger.debug({ artifactId }, "Stopped watching artifact");
  }

  stop(): void {
    const count = this.handles.size;

    this.stopBatchPolling();
    this.activeWatchers.clear();

    for (const handle of this.handles.values()) {
      this.cleanupHandle(handle);
    }
    this.handles.clear();
    if (count > 0) {
      this.logger.info(`Cleaned up ${count} artifact watchers`);
    }
  }

  private cleanupHandle(handle: WatchHandle): void {
    handle.watcher?.close();
    clearTimeout(handle.timeoutTimer ?? undefined);
  }

  private startBatchPolling(): void {
    if (this.batchPollTimer) return;

    this.logger.debug("Started batch polling timer for artifacts");

    this.batchPollTimer = setInterval(() => {
      for (const [artifactId, filePath] of this.activeWatchers.entries()) {
        this.checkFileReady(artifactId, filePath);
      }
    }, BATCH_POLL_INTERVAL_MS);
    this.batchPollTimer?.unref?.();
  }

  private stopBatchPolling(): void {
    if (this.batchPollTimer) {
      clearInterval(this.batchPollTimer);
      this.batchPollTimer = null;
      this.logger.debug("Stopped batch polling timer");
    }
  }

  private async checkFileReady(artifactId: string, filePath: string): Promise<void> {
    const validation = validateHtmlFile(filePath);
    if (validation.isValid) {
      this.writeSanitizedContent(filePath, validation.content);
      await this.updateToReady(artifactId);
    }
  }

  private writeSanitizedContent(filePath: string, content: string): void {
    try {
      const original = readFileSync(filePath, "utf-8");

      if (original !== content) {
        writeFileSync(filePath, content, "utf-8");
        this.logger.debug({ filePath }, "Sanitized artifact HTML content");
      }
    } catch {
      // Ignore errors in sanitization - not critical
    }
  }

  private async updateToReady(artifactId: string): Promise<void> {
    this.unwatch(artifactId);

    try {
      await this.store.update(artifactId, { status: "ready" });
      this.logger.info({ artifactId }, "Artifact generation complete - marked as ready");
      this.emitUpdatedNotification(artifactId);
    } catch (error) {
      this.logger.error({ error, artifactId }, "Failed to update artifact status to ready");
    }
  }

  private handleTimeout(artifactId: string): void {
    // Stop the file watch immediately so a late/partial write can't flip the
    // artifact to "ready" after we've decided it timed out. The service owns
    // the rest of the teardown: it cancels the generation agent (so nothing
    // lingers) and marks the artifact as timed out.
    this.unwatch(artifactId);
    this.logger.warn({ artifactId }, "Artifact generation timed out");
    this.onTimeout(artifactId);
  }

  private async emitUpdatedNotification(artifactId: string): Promise<void> {
    try {
      const metadata = await this.store.get(artifactId);
      if (!metadata) return;

      this.sendNotification(metadata);
    } catch (error) {
      this.logger.error({ error, artifactId }, "Failed to emit updated notification");
    }
  }
}
