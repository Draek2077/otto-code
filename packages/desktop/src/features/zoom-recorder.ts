import { app, BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import { existsSync, promises as fs, type Dirent } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import {
  LocalMeetingTranscriptStore,
  type CreateLocalMeetingTranscriptInput,
  type UpdateLocalMeetingTranscriptInput,
} from "./local-meeting-transcript-store.js";
import { resolveZoomRecorderRuntimePath } from "./zoom-recorder-runtime-path.js";

export type ZoomRecorderState =
  | "unavailable"
  | "idle"
  | "setup"
  | "recording"
  | "transcribing"
  | "ready"
  | "error";

export interface ZoomRecorderStatus {
  available: boolean;
  enabled: boolean;
  modelReady: boolean;
  modelBytes: number;
  state: ZoomRecorderState;
  detail: string;
  ownerPid?: number;
}

interface RuntimeStatusFile {
  state?: unknown;
  detail?: unknown;
  transcript?: unknown;
  pid?: unknown;
}

const INITIAL_STATUS: ZoomRecorderStatus = {
  available: false,
  enabled: false,
  modelReady: false,
  modelBytes: 0,
  state: "unavailable",
  detail: "Zoom Recorder is unavailable on this desktop build.",
};

let status: ZoomRecorderStatus = INITIAL_STATUS;
let watcher: ChildProcessWithoutNullStreams | null = null;
let modelDownload: ChildProcessWithoutNullStreams | null = null;
let statusInterval: NodeJS.Timeout | null = null;
let initialized = false;
const pendingTranscriptPaths = new Map<string, string>();
const missingTranscriptPaths = new Set<string>();
let localTranscriptStore: LocalMeetingTranscriptStore | null = null;

// Do not let a recorder subprocess turn an application quit into an
// unbounded wait. A healthy helper exits immediately after it receives the
// stop signal; the second kill below is solely an escape hatch for a helper
// blocked in an audio driver or native transcription call.
const RECORDER_PROCESS_STOP_TIMEOUT_MS = 3_000;

function getRuntimePath(): string {
  return resolveZoomRecorderRuntimePath({
    configured: process.env.OTTO_ZOOM_RECORDER_PATH,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
  });
}

function getDataRoot(): string {
  return path.join(app.getPath("userData"), "zoom-recorder");
}

function getLocalTranscriptStore(): LocalMeetingTranscriptStore {
  if (!localTranscriptStore) {
    localTranscriptStore = new LocalMeetingTranscriptStore(
      path.join(app.getPath("userData"), "meeting-transcripts"),
    );
  }
  return localTranscriptStore;
}

function getModelsRoot(): string {
  return path.join(getDataRoot(), "models");
}

function getSetupStamp(): string {
  return path.join(getDataRoot(), "state", "setup-complete");
}

function getStatusFile(): string {
  return path.join(getDataRoot(), "state", "status.json");
}

function isSupportedBuild(): boolean {
  return process.arch === "x64" && (process.platform === "linux" || process.platform === "win32");
}

function isAvailable(): boolean {
  return isSupportedBuild() && existsSync(getRuntimePath());
}

function publish(next: Partial<ZoomRecorderStatus>): ZoomRecorderStatus {
  status = { ...status, ...next };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("otto:event:zoom-recorder-status", status);
  }
  return status;
}

async function directorySize(directory: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(directory, { encoding: "utf8", withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(child);
    } else if (entry.isFile()) {
      try {
        total += (await fs.stat(child)).size;
      } catch {
        // The model downloader can replace cache files while this status poll runs.
      }
    }
  }
  return total;
}

function asState(value: unknown): ZoomRecorderState {
  return value === "idle" ||
    value === "setup" ||
    value === "recording" ||
    value === "transcribing" ||
    value === "ready" ||
    value === "error"
    ? value
    : "idle";
}

async function refreshStatus(): Promise<ZoomRecorderStatus> {
  const available = isAvailable();
  const modelBytes = await directorySize(getModelsRoot());
  const modelReady = existsSync(getSetupStamp());
  if (!available) {
    return publish({
      available: false,
      enabled: false,
      modelReady: false,
      modelBytes: 0,
      state: "unavailable",
      detail: "Zoom Recorder is unavailable on this desktop build.",
    });
  }

  let runtime: RuntimeStatusFile | null = null;
  try {
    runtime = JSON.parse(await fs.readFile(getStatusFile(), "utf8")) as RuntimeStatusFile;
  } catch {
    // The helper writes this atomically; absence simply means it has not started yet.
  }
  await publishTranscriptIfReady(runtime?.transcript);
  const runtimeState = asState(runtime?.state);
  // A previous model download can leave `setup` in the advisory status file.
  // Once a watcher has started, the model is already ready, so do not briefly
  // show a fictitious download while the watcher writes its first idle status.
  const watcherHasStaleSetup = watcher !== null && runtimeState === "setup";
  let state: ZoomRecorderState = "idle";
  if (modelDownload) state = "setup";
  else if (watcher) state = watcherHasStaleSetup ? "idle" : runtimeState;

  let detail = "Ready to download the local speech recognition model.";
  if (modelDownload) detail = "Downloading the local speech recognition model.";
  else if (watcherHasStaleSetup) {
    detail = "Waiting for a Zoom call.";
  } else if (typeof runtime?.detail === "string" && runtime.detail.length > 0) {
    detail = runtime.detail;
  } else if (watcher) {
    detail = "Waiting for a Zoom call.";
  } else if (modelReady) {
    detail = "Paused. The local model is ready.";
  }
  const ownerPid = typeof runtime?.pid === "number" ? runtime.pid : undefined;
  return publish({ available, modelReady, modelBytes, state, detail, ownerPid });
}

async function publishTranscriptIfReady(value: unknown): Promise<void> {
  if (typeof value !== "string" || !value) return;
  const transcriptPath = path.resolve(value);
  const recordingsRoot = path.resolve(getDataRoot(), "recordings");
  if (
    !transcriptPath.startsWith(`${recordingsRoot}${path.sep}`) ||
    path.basename(transcriptPath) !== "transcript.md"
  ) {
    log.warn("[zoom-recorder] ignored transcript outside recorder data root");
    return;
  }
  const token = transcriptPath;
  if (missingTranscriptPaths.has(token)) return;
  if (pendingTranscriptPaths.has(token)) return;
  try {
    const [content, metadata] = await Promise.all([
      fs.readFile(transcriptPath, "utf8"),
      fs.stat(transcriptPath),
    ]);
    if (!content.trim()) return;
    pendingTranscriptPaths.set(token, transcriptPath);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("otto:event:zoom-recorder-transcript-ready", {
        token,
        content,
        occurredAt: metadata.mtime.toISOString(),
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // The session may have been acknowledged and deleted between the helper
      // status update and this poll. Do not retry or flood the Electron log.
      missingTranscriptPaths.add(token);
      pendingTranscriptPaths.delete(token);
      return;
    }
    log.warn("[zoom-recorder] failed to read finalized transcript", error);
  }
}

async function listPendingTranscripts(): Promise<
  Array<{ token: string; content: string; occurredAt: string }>
> {
  const recordingsRoot = path.join(getDataRoot(), "recordings");
  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(recordingsRoot, { encoding: "utf8", withFileTypes: true });
  } catch {
    return [];
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        publishTranscriptIfReady(path.join(recordingsRoot, entry.name, "transcript.md")),
      ),
  );
  const pending = await Promise.all(
    [...pendingTranscriptPaths].map(async ([token, transcriptPath]) => {
      try {
        const [content, metadata] = await Promise.all([
          fs.readFile(transcriptPath, "utf8"),
          fs.stat(transcriptPath),
        ]);
        return { token, content, occurredAt: metadata.mtime.toISOString() };
      } catch (error) {
        // The renderer can acknowledge and delete a session while this list is
        // being assembled. Treat that deletion as successful cleanup rather
        // than rejecting the IPC request and wedging the Electron UI.
        pendingTranscriptPaths.delete(token);
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          log.warn("[zoom-recorder] failed to list pending transcript", error);
        }
        return null;
      }
    }),
  );
  return pending.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

async function acknowledgeTranscript(token: unknown): Promise<void> {
  if (typeof token !== "string") throw new Error("Transcript acknowledgment is invalid.");
  const transcriptPath = pendingTranscriptPaths.get(token);
  if (!transcriptPath) return;
  const recordingsRoot = path.resolve(getDataRoot(), "recordings");
  const sessionDirectory = path.dirname(transcriptPath);
  if (!sessionDirectory.startsWith(`${recordingsRoot}${path.sep}`)) {
    throw new Error("Transcript acknowledgment escapes the recorder data root.");
  }
  await fs.rm(sessionDirectory, { recursive: true, force: true });
  pendingTranscriptPaths.delete(token);
}

function parseLocalTranscriptInput(value: unknown): CreateLocalMeetingTranscriptInput {
  if (!value || typeof value !== "object") throw new Error("Transcript is invalid.");
  const input = value as Partial<CreateLocalMeetingTranscriptInput>;
  if (
    typeof input.provider !== "string" ||
    typeof input.title !== "string" ||
    typeof input.content !== "string" ||
    typeof input.occurredAt !== "string" ||
    (input.deliveryState !== "local_only" &&
      input.deliveryState !== "waiting_for_secure_connection" &&
      input.deliveryState !== "delivery_failed")
  ) {
    throw new Error("Transcript is invalid.");
  }
  const provider = input.provider.trim();
  const title = input.title.trim();
  const content = input.content.trim();
  if (!provider || !title || !content) throw new Error("Transcript is invalid.");
  return {
    provider,
    title,
    content,
    occurredAt: input.occurredAt,
    deliveryState: input.deliveryState,
  };
}

function parseLocalTranscriptUpdate(value: unknown): UpdateLocalMeetingTranscriptInput {
  if (!value || typeof value !== "object") throw new Error("Transcript update is invalid.");
  const input = value as Partial<UpdateLocalMeetingTranscriptInput>;
  if (typeof input.id !== "string" || (input.title === undefined && input.content === undefined)) {
    throw new Error("Transcript update is invalid.");
  }
  if (input.title !== undefined && (typeof input.title !== "string" || !input.title.trim())) {
    throw new Error("Transcript update is invalid.");
  }
  if (input.content !== undefined && (typeof input.content !== "string" || !input.content.trim())) {
    throw new Error("Transcript update is invalid.");
  }
  return {
    id: input.id,
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.content !== undefined ? { content: input.content.trim() } : {}),
  };
}

function waitForProcessExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  let timer: NodeJS.Timeout | null = null;
  let resolveExited: (exited: boolean) => void = () => undefined;
  const exited = new Promise<boolean>((resolve) => {
    resolveExited = resolve;
  });
  const onExit = () => resolveExited(true);
  child.once("exit", onExit);
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  return Promise.race([exited, timedOut]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
    child.removeListener("exit", onExit);
  });
}

async function stopProcess(child: ChildProcessWithoutNullStreams | null): Promise<boolean> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return true;
  }

  if (process.platform === "win32" && child.pid) {
    return stopWindowsProcessTree(child);
  }

  try {
    child.kill();
  } catch {
    // The helper can exit between checking its state and delivering the signal.
  }
  if (await waitForProcessExit(child, RECORDER_PROCESS_STOP_TIMEOUT_MS)) {
    return true;
  }

  log.warn("[zoom-recorder] helper did not stop after the graceful timeout; forcing exit", {
    pid: child.pid,
  });
  try {
    child.kill("SIGKILL");
  } catch {
    // The helper may have exited after the graceful wait elapsed.
  }
  return waitForProcessExit(child, RECORDER_PROCESS_STOP_TIMEOUT_MS);
}

async function stopWindowsProcessTree(child: ChildProcessWithoutNullStreams): Promise<boolean> {
  // The frozen recorder is a PyInstaller one-file executable. Its bootstrap
  // process is the PID Electron spawned, but it launches the real recorder as
  // a child. Killing only the bootstrap makes ChildProcess report success while
  // leaving the real recorder alive with inherited console handles.
  let taskkill: ReturnType<typeof spawn>;
  try {
    // taskkill's /t is essential: it removes the PyInstaller worker along
    // with the bootstrap, which Node's child.kill() cannot express.
    taskkill = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    log.warn("[zoom-recorder] could not start taskkill for the helper process tree", {
      pid: child.pid,
    });
    try {
      child.kill("SIGKILL");
    } catch {
      // The helper can exit between spawning taskkill and this fallback.
    }
    return waitForProcessExit(child, RECORDER_PROCESS_STOP_TIMEOUT_MS);
  }

  let timer: NodeJS.Timeout | null = null;
  let onExit: ((code: number | null) => void) | null = null;
  let onError: (() => void) | null = null;
  const exited = new Promise<boolean>((resolve) => {
    onExit = (code) => resolve(code === 0);
    taskkill.once("exit", onExit);
  });
  const failed = new Promise<boolean>((resolve) => {
    onError = () => resolve(false);
    taskkill.once("error", onError);
  });
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), RECORDER_PROCESS_STOP_TIMEOUT_MS);
  });
  const treeStopped = await Promise.race([exited, failed, timedOut]).finally(() => {
    if (timer) clearTimeout(timer);
    if (onExit) taskkill.removeListener("exit", onExit);
    if (onError) taskkill.removeListener("error", onError);
  });

  if (treeStopped) {
    return waitForProcessExit(child, RECORDER_PROCESS_STOP_TIMEOUT_MS);
  }

  log.warn("[zoom-recorder] taskkill could not stop the helper process tree", {
    pid: child.pid,
  });
  try {
    child.kill("SIGKILL");
  } catch {
    // The helper may already have exited while taskkill was running.
  }
  return waitForProcessExit(child, RECORDER_PROCESS_STOP_TIMEOUT_MS);
}

async function stopRecorderProcesses(): Promise<void> {
  const activeWatcher = watcher;
  const activeDownload = modelDownload;
  // Clear the references before signaling. Their exit handlers must not publish
  // a late status update or schedule filesystem work during application quit.
  watcher = null;
  modelDownload = null;
  stopStatusPolling();
  await Promise.all([stopProcess(activeWatcher), stopProcess(activeDownload)]);
}

function helperEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, ZOOM_RECORDER_HOME: getDataRoot() };
}

function forwardHelperOutput(child: ChildProcessWithoutNullStreams, operation: string): void {
  child.stdout.on("data", (chunk: Buffer) => {
    const output = chunk.toString().trim();
    if (output) log.info(`[zoom-recorder] ${operation}: ${output}`);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const output = chunk.toString().trim();
    if (output) log.warn(`[zoom-recorder] ${operation}: ${output}`);
  });
}

function startWatcher(): void {
  if (watcher || !status.enabled) return;
  const executable = getRuntimePath();
  const activeWatcher = spawn(executable, ["watch"], {
    env: helperEnvironment(),
    windowsHide: true,
  });
  watcher = activeWatcher;
  forwardHelperOutput(activeWatcher, "watcher");
  activeWatcher.on("error", (error) => {
    if (watcher !== activeWatcher) return;
    log.error("[zoom-recorder] watcher failed", error);
    watcher = null;
    publish({ state: "error", detail: `Zoom Recorder failed to start: ${error.message}` });
  });
  activeWatcher.on("exit", (code, signal) => {
    if (watcher !== activeWatcher) return;
    watcher = null;
    if (status.enabled && code === 73) {
      publish({
        state: "error",
        detail: "Zoom Recorder is already running in another Otto instance.",
      });
    } else if (status.enabled && !modelDownload && code !== 0 && signal !== "SIGTERM") {
      publish({
        state: "error",
        detail: `Zoom Recorder stopped unexpectedly (exit ${code ?? signal}).`,
      });
    }
    void refreshStatus();
  });
  void refreshStatus();
}

function beginModelDownload(): void {
  if (modelDownload) return;
  const executable = getRuntimePath();
  const activeDownload = spawn(executable, ["otto-download-models"], {
    env: helperEnvironment(),
    windowsHide: true,
  });
  modelDownload = activeDownload;
  forwardHelperOutput(activeDownload, "model download");
  activeDownload.on("error", (error) => {
    if (modelDownload !== activeDownload) return;
    log.error("[zoom-recorder] model download failed", error);
    modelDownload = null;
    publish({ state: "error", detail: `Model download failed: ${error.message}` });
  });
  activeDownload.on("exit", (code) => {
    if (modelDownload !== activeDownload) return;
    modelDownload = null;
    if (!status.enabled) {
      void refreshStatus();
      return;
    }
    if (code === 0) {
      startWatcher();
    } else {
      publish({ state: "error", detail: "Model download did not complete." });
    }
    void refreshStatus();
  });
  void refreshStatus();
}

function startStatusPolling(): void {
  if (statusInterval) return;
  statusInterval = setInterval(() => void refreshStatus(), 1_000);
}

function stopStatusPolling(): void {
  if (statusInterval) clearInterval(statusInterval);
  statusInterval = null;
}

export async function getZoomRecorderStatus(): Promise<ZoomRecorderStatus> {
  return refreshStatus();
}

export async function enableZoomRecorder(): Promise<ZoomRecorderStatus> {
  await refreshStatus();
  if (!status.available) return status;
  publish({ enabled: true });
  startStatusPolling();
  if (existsSync(getSetupStamp())) {
    startWatcher();
  } else {
    beginModelDownload();
  }
  return refreshStatus();
}

export async function disableZoomRecorder(): Promise<ZoomRecorderStatus> {
  publish({ enabled: false });
  await stopRecorderProcesses();
  return refreshStatus();
}

/**
 * Stops host-local recorder work as a bounded, awaitable quit phase. Unlike a
 * normal disable this does not refresh status or send renderer events after the
 * window has started closing.
 */
export async function shutdownZoomRecorderForQuit(): Promise<void> {
  log.info("[zoom-recorder] quit shutdown started", {
    watcherPid: watcher?.pid ?? null,
    modelDownloadPid: modelDownload?.pid ?? null,
  });
  status = { ...status, enabled: false };
  await stopRecorderProcesses();
  log.info("[zoom-recorder] quit shutdown completed");
}

export async function takeOverZoomRecorder(): Promise<ZoomRecorderStatus> {
  const runtime = await refreshStatus();
  const ownerPid = runtime.ownerPid;
  if (ownerPid && ownerPid !== process.pid) {
    try {
      process.kill(ownerPid);
    } catch {
      // The owner may have exited between reading status and sending the signal.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!status.enabled) publish({ enabled: true });
  if (existsSync(getSetupStamp())) startWatcher();
  return refreshStatus();
}

export async function deleteZoomRecorderModel(): Promise<ZoomRecorderStatus> {
  await disableZoomRecorder();
  await fs.rm(getModelsRoot(), { recursive: true, force: true });
  await fs.rm(getSetupStamp(), { force: true });
  return refreshStatus();
}

export function registerZoomRecorderHandlers(options: {
  isTrustedSender: (sender: Electron.WebContents) => boolean;
}): void {
  if (initialized) return;
  initialized = true;
  const requireTrustedSender = (event: Electron.IpcMainInvokeEvent): void => {
    if (!options.isTrustedSender(event.sender)) {
      throw new Error("Rejected IPC from an untrusted renderer.");
    }
  };
  ipcMain.handle("otto:zoom-recorder:status", (event) => {
    requireTrustedSender(event);
    return getZoomRecorderStatus();
  });
  ipcMain.handle("otto:zoom-recorder:enable", (event) => {
    requireTrustedSender(event);
    return enableZoomRecorder();
  });
  ipcMain.handle("otto:zoom-recorder:disable", (event) => {
    requireTrustedSender(event);
    return disableZoomRecorder();
  });
  ipcMain.handle("otto:zoom-recorder:take-over", (event) => {
    requireTrustedSender(event);
    return takeOverZoomRecorder();
  });
  ipcMain.handle("otto:zoom-recorder:delete-model", (event) => {
    requireTrustedSender(event);
    return deleteZoomRecorderModel();
  });
  ipcMain.handle("otto:zoom-recorder:list-pending-transcripts", (event) => {
    requireTrustedSender(event);
    return listPendingTranscripts();
  });
  ipcMain.handle("otto:zoom-recorder:acknowledge-transcript", (event, token: unknown) => {
    requireTrustedSender(event);
    return acknowledgeTranscript(token);
  });
  ipcMain.handle("otto:meeting-transcripts:local:list", (event) => {
    requireTrustedSender(event);
    return getLocalTranscriptStore().list();
  });
  ipcMain.handle("otto:meeting-transcripts:local:create", (event, input: unknown) => {
    requireTrustedSender(event);
    return getLocalTranscriptStore().create(parseLocalTranscriptInput(input));
  });
  ipcMain.handle("otto:meeting-transcripts:local:update", (event, input: unknown) => {
    requireTrustedSender(event);
    return getLocalTranscriptStore().update(parseLocalTranscriptUpdate(input));
  });
  ipcMain.handle("otto:meeting-transcripts:local:delete", (event, id: unknown) => {
    requireTrustedSender(event);
    if (typeof id !== "string") throw new Error("Transcript id is invalid.");
    return getLocalTranscriptStore().delete(id);
  });
}
