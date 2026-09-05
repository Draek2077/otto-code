import { realpathSync, statSync, watch as fsWatch, writeFileSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { Logger } from "pino";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { validateHtmlFile } from "./html-validator.js";
import type { ArtifactStore } from "./artifact-store.js";

const BATCH_POLL_INTERVAL_MS = 1000;
// How long a ready artifact's file may look invalid before it is reported as
// an external edit. Editors save by writing a temp file and renaming it over
// the target, so a watched file is routinely missing or truncated for a few
// milliseconds; declaring an error on the first bad read would flag every
// legitimate save and offer a Repair that overwrites the user's finished edit.
const INVALID_FILE_GRACE_MS = 300;

interface ArtifactWatcherOptions {
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
  store: ArtifactStore;
  filePath: string;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  mode: "generation" | "ready";
  lastKnownContent: string | null;
  lastKnownMetadata: string | null;
  // Ready mode: mtime+size of the HTML and the record as of the last read.
  // A poll tick whose stat matches skips the read entirely, which is what
  // keeps a library of ready artifacts from being re-read once a second.
  htmlSignature: string | null;
  recordSignature: string | null;
  checking: boolean;
  // Ready mode: when the file first read as invalid, so the grace period can
  // tell an in-progress editor save from a genuinely broken file.
  invalidSince: number | null;
  // Fired once the artifact flips to "ready", after the store update commits.
  // Lets the service clean up generation-scoped state (e.g. a regeneration
  // backup file) without the watcher knowing what that state is.
  onReady: (() => Promise<void>) | null;
  onExternalChange: ((content: string | null) => Promise<void>) | null;
  onMetadataChange: ((metadata: ArtifactMetadata) => void) | null;
}

// One OS watch per artifacts directory, shared by every artifact stored
// there. Every artifact in a store lives in the same directory, so a watch
// per artifact would multiply both OS handles and event fan-out by the size
// of the library; instead the directory event is routed to the one handle
// whose HTML or record file changed.
interface DirectoryWatch {
  watcher: FSWatcher;
  artifactIds: Set<string>;
}

export class ArtifactWatcher {
  private readonly logger: Logger;
  private readonly sendNotification: (metadata: ArtifactMetadata) => void;
  private readonly timeoutMs: number;
  private readonly onTimeout: (artifactId: string) => void;
  private readonly activeWatchers: Map<string, string> = new Map();
  private readonly handles: Map<string, WatchHandle> = new Map();
  private readonly directoryWatches: Map<string, DirectoryWatch> = new Map();
  private batchPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ArtifactWatcherOptions) {
    this.logger = options.logger.child({ module: "artifact-watcher" });
    this.sendNotification = options.sendNotification;
    this.timeoutMs = options.timeoutMs;
    this.onTimeout = options.onTimeout;
  }

  watch(
    artifactId: string,
    filePath: string,
    store: ArtifactStore,
    onReady?: () => Promise<void>,
  ): void {
    if (this.handles.has(artifactId)) {
      return;
    }

    const handle: WatchHandle = {
      store,
      filePath,
      timeoutTimer: null,
      mode: "generation",
      lastKnownContent: null,
      lastKnownMetadata: null,
      htmlSignature: null,
      recordSignature: null,
      checking: false,
      invalidSince: null,
      onReady: onReady ?? null,
      onExternalChange: null,
      onMetadataChange: null,
    };
    this.handles.set(artifactId, handle);

    const validation = validateHtmlFile(filePath);
    if (validation.isValid) {
      this.writeSanitizedContent(filePath, validation);
      this.updateToReady(artifactId);
      return;
    }

    this.watchDirectory(artifactId, filePath);

    this.activeWatchers.set(artifactId, filePath);
    this.startBatchPolling();

    handle.timeoutTimer = setTimeout(() => {
      this.handleTimeout(artifactId);
    }, this.timeoutMs);
    handle.timeoutTimer?.unref?.();

    this.logger.debug({ artifactId, filePath }, "Watching for artifact file creation");
  }

  /** Monitor a ready artifact for external file changes. Valid changes become
   * the next last-known-good output; invalid files remain in place and are
   * handed to the service for explicit repair. */
  watchReady(
    artifactId: string,
    filePath: string,
    store: ArtifactStore,
    onExternalChange: (content: string | null) => Promise<void>,
    onMetadataChange: (metadata: ArtifactMetadata) => void,
  ): void {
    if (this.handles.has(artifactId)) return;

    const validation = validateHtmlFile(filePath);
    const handle: WatchHandle = {
      store,
      filePath,
      timeoutTimer: null,
      mode: "ready",
      lastKnownContent: validation.isValid ? validation.content : null,
      lastKnownMetadata: null,
      htmlSignature: null,
      recordSignature: null,
      checking: false,
      invalidSince: null,
      onReady: null,
      onExternalChange,
      onMetadataChange,
    };
    this.handles.set(artifactId, handle);
    void store
      .get(artifactId)
      .then((metadata) => {
        if (metadata) handle.lastKnownMetadata = JSON.stringify(metadata);
        return undefined;
      })
      .catch((error) =>
        this.logger.warn({ error, artifactId }, "Failed to read artifact metadata"),
      );

    if (!validation.isValid) {
      void this.handleExternalChange(artifactId, null);
      return;
    }

    this.writeSanitizedContent(filePath, validation);
    handle.htmlSignature = fileSignature(filePath);
    handle.recordSignature = fileSignature(store.recordPath(artifactId));
    this.watchDirectory(artifactId, filePath);
    this.activeWatchers.set(artifactId, filePath);
    this.startBatchPolling();
  }

  unwatch(artifactId: string): void {
    const handle = this.handles.get(artifactId);
    if (!handle) return;

    this.activeWatchers.delete(artifactId);

    if (this.activeWatchers.size === 0) {
      this.stopBatchPolling();
    }

    this.cleanupHandle(artifactId, handle);
    this.handles.delete(artifactId);
    this.logger.debug({ artifactId }, "Stopped watching artifact");
  }

  stop(): void {
    const count = this.handles.size;

    this.stopBatchPolling();
    this.activeWatchers.clear();

    for (const [artifactId, handle] of this.handles.entries()) {
      this.cleanupHandle(artifactId, handle);
    }
    this.handles.clear();
    for (const directoryWatch of this.directoryWatches.values()) {
      directoryWatch.watcher.close();
    }
    this.directoryWatches.clear();
    if (count > 0) {
      this.logger.info(`Cleaned up ${count} artifact watchers`);
    }
  }

  private cleanupHandle(artifactId: string, handle: WatchHandle): void {
    this.releaseDirectory(artifactId, handle.filePath);
    clearTimeout(handle.timeoutTimer ?? undefined);
  }

  private startBatchPolling(): void {
    if (this.batchPollTimer) return;

    this.logger.debug("Started batch polling timer for artifacts");

    this.batchPollTimer = setInterval(() => {
      for (const [artifactId, filePath] of this.activeWatchers.entries()) {
        void this.checkFileReady(artifactId, filePath);
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
    const handle = this.handles.get(artifactId);
    if (!handle || handle.checking) return;
    handle.checking = true;
    try {
      if (handle.mode === "ready") {
        await this.checkReadyFile(artifactId, filePath, handle);
        return;
      }
      const validation = validateHtmlFile(filePath);
      if (validation.isValid) {
        this.writeSanitizedContent(filePath, validation);
        await this.updateToReady(artifactId);
      }
    } finally {
      handle.checking = false;
    }
  }

  private async checkReadyFile(
    artifactId: string,
    filePath: string,
    handle: WatchHandle,
  ): Promise<void> {
    const signature = fileSignature(filePath);
    const htmlUnchanged =
      signature !== null && signature === handle.htmlSignature && handle.invalidSince === null;
    if (!htmlUnchanged) {
      const validation = validateHtmlFile(filePath);
      if (!validation.isValid) {
        if (handle.invalidSince === null) {
          handle.invalidSince = Date.now();
          // Look again once the grace period is over: an fs event may never
          // follow an editor's final rename, and the batch poll may be idle.
          const recheck = setTimeout(() => {
            void this.checkFileReady(artifactId, filePath);
          }, INVALID_FILE_GRACE_MS);
          recheck.unref?.();
          return;
        }
        if (Date.now() - handle.invalidSince < INVALID_FILE_GRACE_MS) return;
        await this.handleExternalChange(artifactId, null);
        return;
      }
      handle.invalidSince = null;
      this.writeSanitizedContent(filePath, validation);
      handle.htmlSignature = fileSignature(filePath);
      const contentChanged = handle.lastKnownContent !== validation.content;
      handle.lastKnownContent = validation.content;
      if (contentChanged) {
        await this.handleExternalChange(artifactId, validation.content);
        return;
      }
    }
    await this.checkMetadataChange(artifactId, handle);
  }

  private async checkMetadataChange(artifactId: string, handle: WatchHandle): Promise<void> {
    const recordPath = handle.store.recordPath(artifactId);
    const signature = fileSignature(recordPath);
    if (signature !== null && signature === handle.recordSignature) return;
    try {
      const metadata = await handle.store.get(artifactId);
      handle.recordSignature = signature;
      if (!metadata) return;
      const serialized = JSON.stringify(metadata);
      if (serialized === handle.lastKnownMetadata) return;
      handle.lastKnownMetadata = serialized;
      handle.onMetadataChange?.(metadata);
    } catch (error) {
      this.logger.warn({ error, artifactId }, "External artifact metadata is invalid");
    }
  }

  private writeSanitizedContent(
    filePath: string,
    validation: { content: string; raw: string },
  ): void {
    if (validation.raw === validation.content) return;
    try {
      writeFileSync(filePath, validation.content, "utf-8");
      this.logger.debug({ filePath }, "Sanitized artifact HTML content");
    } catch {
      // Ignore errors in sanitization - not critical
    }
  }

  private async updateToReady(artifactId: string): Promise<void> {
    const handle = this.handles.get(artifactId);
    if (!handle) return;
    const onReady = handle.onReady;
    this.unwatch(artifactId);

    try {
      await handle.store.update(artifactId, { status: "ready" });
      this.logger.info({ artifactId }, "Artifact generation complete - marked as ready");
      await onReady?.();
      this.emitUpdatedNotification(artifactId, handle.store);
    } catch (error) {
      this.logger.error({ error, artifactId }, "Failed to update artifact status to ready");
    }
  }

  private watchDirectory(artifactId: string, filePath: string): void {
    const artifactsDir = dirname(filePath);
    const existing = this.directoryWatches.get(artifactsDir);
    if (existing) {
      existing.artifactIds.add(artifactId);
      return;
    }
    try {
      const artifactIds = new Set([artifactId]);
      // Windows libuv can abort on an 8.3 watch root (libuv/libuv#5152).
      // Keep store/event identity unchanged while opening the native long path.
      const watchRoot =
        process.platform === "win32" ? realpathSync.native(artifactsDir) : artifactsDir;
      const watcher = fsWatch(watchRoot, { persistent: false }, (_event, filename) => {
        this.dispatchDirectoryEvent(artifactsDir, artifactIds, filename);
      });
      watcher.on("error", (error) => {
        this.logger.warn(
          { error, dir: artifactsDir },
          "Artifacts directory watch failed, relying on polling fallback",
        );
      });
      this.directoryWatches.set(artifactsDir, { watcher, artifactIds });
      this.logger.debug({ dir: artifactsDir }, "Started fs.watch on artifacts directory");
    } catch (error) {
      this.logger.warn(
        { error, artifactId },
        "Failed to set up fs.watch, relying on polling fallback",
      );
    }
  }

  private dispatchDirectoryEvent(
    artifactsDir: string,
    artifactIds: Set<string>,
    filename: string | Buffer | null,
  ): void {
    const changed = filename === null ? null : filename.toString();
    for (const artifactId of artifactIds) {
      const handle = this.handles.get(artifactId);
      if (!handle) continue;
      // Platforms that report no filename get a full fan-out; otherwise only
      // the artifact whose own HTML or record changed pays for a check.
      if (
        changed !== null &&
        changed !== basename(handle.filePath) &&
        changed !== basename(handle.store.recordPath(artifactId))
      ) {
        continue;
      }
      void this.checkFileReady(artifactId, handle.filePath);
    }
    if (artifactIds.size === 0) this.closeDirectoryWatch(artifactsDir);
  }

  private releaseDirectory(artifactId: string, filePath: string): void {
    const artifactsDir = dirname(filePath);
    const directoryWatch = this.directoryWatches.get(artifactsDir);
    if (!directoryWatch) return;
    directoryWatch.artifactIds.delete(artifactId);
    if (directoryWatch.artifactIds.size === 0) this.closeDirectoryWatch(artifactsDir);
  }

  private closeDirectoryWatch(artifactsDir: string): void {
    const directoryWatch = this.directoryWatches.get(artifactsDir);
    if (!directoryWatch) return;
    directoryWatch.watcher.close();
    this.directoryWatches.delete(artifactsDir);
  }

  private async handleExternalChange(artifactId: string, content: string | null): Promise<void> {
    const handle = this.handles.get(artifactId);
    if (!handle) return;
    this.unwatch(artifactId);
    try {
      await handle.onExternalChange?.(content);
    } catch (error) {
      this.logger.error({ error, artifactId }, "Failed to reconcile external artifact edit");
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

  private async emitUpdatedNotification(artifactId: string, store: ArtifactStore): Promise<void> {
    try {
      const metadata = await store.get(artifactId);
      if (!metadata) return;

      this.sendNotification(metadata);
    } catch (error) {
      this.logger.error({ error, artifactId }, "Failed to emit updated notification");
    }
  }
}

/** mtime+size of a file, or null when it cannot be read (missing, mid-rename). */
function fileSignature(filePath: string): string | null {
  try {
    const stats = statSync(filePath);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return null;
  }
}
