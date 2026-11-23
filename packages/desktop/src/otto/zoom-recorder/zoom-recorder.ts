import { app, BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import {
  LocalMeetingTranscriptStore,
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
const acceptingTranscripts = new Set<string>();
const acceptedTranscripts = new Set<string>();
let recorderAction = Promise.resolve();
let quitting = false;
let refreshing: Promise<ZoomRecorderStatus> | undefined;
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
    window.webContents.send("paseo:event:zoom-recorder-status", status);
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

function refreshStatus(): Promise<ZoomRecorderStatus> {
  refreshing ??= readStatus().finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}

async function readStatus(): Promise<ZoomRecorderStatus> {
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
  const relative = path.relative(recordingsRoot, transcriptPath).split(path.sep);
  if (relative.length !== 2 || relative[0] === ".." || relative[1] !== "transcript.md") return;
  if (acceptedTranscripts.has(transcriptPath) || acceptingTranscripts.has(transcriptPath)) return;
  acceptingTranscripts.add(transcriptPath);
  try {
    const [realRoot, realFile] = await Promise.all([
      fs.realpath(recordingsRoot),
      fs.realpath(transcriptPath),
    ]);
    if (realFile !== path.join(realRoot, ...relative)) return;
    const metadata = await fs.stat(realFile);
    if (!metadata.isFile() || metadata.size > 8 * 1024 * 1024) return;
    const content = await fs.readFile(realFile, "utf8");
    if (!content.trim()) return;
    const receipt = createHash("sha256")
      .update(relative[0])
      .update("\0")
      .update(content)
      .digest("hex");
    await getLocalTranscriptStore().capture(receipt, content, metadata.mtime.toISOString());
    // The finalized helper text is acknowledged only after the library commits.
    await fs.unlink(realFile);
    acceptedTranscripts.add(transcriptPath);
    if (acceptedTranscripts.size > 128) {
      const oldest = acceptedTranscripts.values().next().value;
      if (oldest !== undefined) acceptedTranscripts.delete(oldest);
    }
    // Main owns capture receipts, including in multi-window and renderer reload cases.
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("paseo:event:zoom-recorder-transcript-saved");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("[zoom-recorder] could not retain finalized transcript", error);
    }
  } finally {
    acceptingTranscripts.delete(transcriptPath);
  }
}

async function recoverTranscripts(): Promise<void> {
  const root = path.join(getDataRoot(), "recordings");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (entry.isDirectory())
      await publishTranscriptIfReady(path.join(root, entry.name, "transcript.md"));
  }
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
  if (quitting || !status.available) return status;
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
  quitting = true;
  log.info("[zoom-recorder] quit shutdown started", {
    watcherPid: watcher?.pid ?? null,
    modelDownloadPid: modelDownload?.pid ?? null,
  });
  status = { ...status, enabled: false };
  await stopRecorderProcesses();
  log.info("[zoom-recorder] quit shutdown completed");
}

function runRecorderAction<T>(operation: () => Promise<T>): Promise<T> {
  const result = recorderAction.then(operation);
  recorderAction = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function persistRecorderPreference(enabled: boolean): Promise<void> {
  const root = getDataRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = path.join(root, `preference-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, enabled ? "enabled" : "disabled", { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, path.join(root, "recorder-preference"));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function updateRecorderPreference(enabled: boolean): Promise<ZoomRecorderStatus> {
  return runRecorderAction(async () => {
    if (quitting || (enabled && !isAvailable())) return status;
    await persistRecorderPreference(enabled);
    return enabled ? enableZoomRecorder() : disableZoomRecorder();
  });
}

export function restoreZoomRecorderPreference(): void {
  if (!isAvailable()) return;
  void runRecorderAction(async () => {
    const preference = await fs
      .readFile(path.join(getDataRoot(), "recorder-preference"), "utf8")
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw error;
      });
    if (preference === "enabled") await enableZoomRecorder();
  }).catch((error: unknown) => {
    log.warn("[zoom-recorder] could not restore recorder preference", error);
  });
}

export function deleteZoomRecorderModel(): Promise<ZoomRecorderStatus> {
  return runRecorderAction(async () => {
    if (quitting) return status;
    await persistRecorderPreference(false);
    await disableZoomRecorder();
    await fs.rm(getModelsRoot(), { recursive: true, force: true });
    await fs.rm(getSetupStamp(), { force: true });
    return refreshStatus();
  });
}

export function registerZoomRecorderHandlers(options: {
  isTrustedSender: (event: Electron.IpcMainInvokeEvent) => boolean;
}): void {
  if (initialized) return;
  initialized = true;
  const requireTrustedSender = (event: Electron.IpcMainInvokeEvent): void => {
    if (!options.isTrustedSender(event)) {
      throw new Error("Rejected IPC from an untrusted renderer.");
    }
  };
  ipcMain.handle("otto:zoom-recorder:status", (event) => {
    requireTrustedSender(event);
    return getZoomRecorderStatus();
  });
  ipcMain.handle("otto:zoom-recorder:enable", (event) => {
    requireTrustedSender(event);
    return updateRecorderPreference(true);
  });
  ipcMain.handle("otto:zoom-recorder:disable", (event) => {
    requireTrustedSender(event);
    return updateRecorderPreference(false);
  });
  ipcMain.handle("otto:zoom-recorder:delete-model", (event) => {
    requireTrustedSender(event);
    return deleteZoomRecorderModel();
  });
  ipcMain.handle("otto:meeting-transcripts:local:list", async (event) => {
    requireTrustedSender(event);
    await recoverTranscripts();
    return getLocalTranscriptStore().list();
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
