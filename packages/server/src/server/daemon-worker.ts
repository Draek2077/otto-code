import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createOttoDaemon } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { resolveOttoHome } from "./otto-home.js";
import { createRootLogger } from "./logger.js";
import type { DaemonLifecycleIntent } from "./bootstrap.js";
import { getProcessDiagnostics } from "./process-diagnostics.js";
import { DAEMON_FATAL_EXIT_CODE } from "./daemon-exit-codes.js";

process.title = "Otto Daemon";

// Walk the error and its `cause` chain looking for a listen conflict. A failed
// bind can surface either directly or wrapped, so check a few levels deep.
function isAddressInUseError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (typeof current === "object" && "code" in current) {
      if ((current as { code?: unknown }).code === "EADDRINUSE") {
        return true;
      }
      current = (current as { cause?: unknown }).cause ?? null;
    } else {
      break;
    }
  }
  return false;
}

type SupervisorLifecycleMessage =
  | {
      type: "otto:shutdown";
      reason: string;
    }
  | {
      type: "otto:ready";
      listen: string;
    }
  | {
      type: "otto:restart";
      reason?: string;
    };

interface SupervisorHeartbeatMessage {
  type: "otto:supervisor-heartbeat";
}

interface BootstrapResult {
  ottoHome: string;
  logger: ReturnType<typeof createRootLogger>;
  config: ReturnType<typeof loadConfig>;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

function writeWorkerLifecycleLog(
  ottoHome: string,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  try {
    const logPath = path.join(ottoHome, "daemon.log");
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(
      logPath,
      `${JSON.stringify({
        level: "warn",
        time: new Date().toISOString(),
        pid: process.pid,
        name: "DaemonWorker",
        msg: message,
        ...fields,
      })}\n`,
      "utf8",
    );
  } catch {
    // Exit-reason logging must never prevent the worker from exiting.
  }
}

function bootstrapFromEnvironment(): BootstrapResult {
  try {
    const ottoHome = resolveOttoHome();
    const config = loadConfig(ottoHome);
    const logger = createRootLogger({ log: config.log }, { ottoHome, file: false });
    return { ottoHome, logger, config };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

function applyCliFlagOverrides(config: ReturnType<typeof loadConfig>): void {
  if (process.argv.includes("--no-relay")) {
    config.relayEnabled = false;
  }
  if (process.argv.includes("--relay-use-tls")) {
    config.relayUseTls = true;
  }
  if (process.argv.includes("--no-mcp")) {
    config.mcpEnabled = false;
  }
  if (process.argv.includes("--no-inject-mcp")) {
    config.mcpInjectIntoAgents = false;
  }
  if (process.argv.includes("--web-ui")) {
    config.webUi = { ...(config.webUi ?? { distDir: null }), enabled: true };
  }
  if (process.argv.includes("--no-web-ui")) {
    config.webUi = { ...(config.webUi ?? { distDir: null }), enabled: false };
  }
}

async function main() {
  const { ottoHome, logger, config } = bootstrapFromEnvironment();
  let daemon: Awaited<ReturnType<typeof createOttoDaemon>> | null = null;
  let shutdownPromise: Promise<number> | null = null;
  let exitHookInstalled = false;

  applyCliFlagOverrides(config);

  const installExitHook = () => {
    if (exitHookInstalled || !shutdownPromise) {
      return;
    }
    exitHookInstalled = true;
    void shutdownPromise.then((exitCode) => {
      process.exit(exitCode);
    });
  };

  const beginShutdown = (
    signal: string,
    options?: {
      reason?: string;
      successExitCode?: number;
    },
  ) => {
    const reason = options?.reason ?? `worker_received_${signal}`;
    if (!shutdownPromise) {
      logger.info(
        { signal, reason, ...getProcessDiagnostics() },
        `${signal} received, shutting down gracefully...`,
      );

      shutdownPromise = (async () => {
        const forceExit = setTimeout(() => {
          logger.warn(
            { signal, reason, ...getProcessDiagnostics() },
            "Forcing shutdown - HTTP server didn't close in time",
          );
          process.exit(1);
        }, 10000);

        try {
          if (!daemon) {
            logger.error("Shutdown requested before daemon initialization completed");
            clearTimeout(forceExit);
            return 1;
          }
          await daemon.stop();
          clearTimeout(forceExit);
          logger.info("Server closed");
          return options?.successExitCode ?? 0;
        } catch (err) {
          clearTimeout(forceExit);
          logger.error({ err }, "Shutdown failed");
          return 1;
        }
      })();
    } else {
      logger.info(
        { signal, reason, ...getProcessDiagnostics() },
        `${signal} received while shutdown is already in progress`,
      );
    }

    installExitHook();
  };

  const sendSupervisorLifecycleMessage = (message: SupervisorLifecycleMessage): boolean => {
    if (typeof process.send !== "function") {
      return false;
    }
    try {
      process.send(message);
      return true;
    } catch (err) {
      logger.error({ err, message }, "Failed to send lifecycle IPC message to supervisor");
      return false;
    }
  };

  const handleLifecycleIntent = (intent: DaemonLifecycleIntent) => {
    if (intent.type === "shutdown") {
      logger.warn(
        { clientId: intent.clientId, requestId: intent.requestId, reason: intent.reason },
        "Shutdown requested via websocket",
      );
      if (sendSupervisorLifecycleMessage({ type: "otto:shutdown", reason: intent.reason })) {
        return;
      }
      beginShutdown("shutdown lifecycle intent", { reason: intent.reason });
      return;
    }

    logger.warn(
      { clientId: intent.clientId, requestId: intent.requestId, reason: intent.reason },
      "Restart requested via websocket",
    );
    if (
      sendSupervisorLifecycleMessage({
        type: "otto:restart",
        ...(intent.reason ? { reason: intent.reason } : {}),
      })
    ) {
      return;
    }
    beginShutdown("restart lifecycle intent", {
      reason: intent.reason,
      successExitCode: 0,
    });
  };

  const installSupervisorLivenessGuard = () => {
    if (typeof process.send !== "function") {
      return;
    }

    const supervisorPid = process.ppid;
    let lastSupervisorHeartbeatAt = Date.now();
    let supervisorExitRequested = false;
    const exitAfterSupervisorLoss = (reason: string) => {
      if (supervisorExitRequested) {
        return;
      }
      supervisorExitRequested = true;

      writeWorkerLifecycleLog(ottoHome, "Supervisor liveness lost; worker exiting", {
        reason,
        ...getProcessDiagnostics(),
        supervisorPid,
        currentParentPid: process.ppid,
        ipcConnected: typeof process.connected === "boolean" ? process.connected : null,
        heartbeatAgeMs: Date.now() - lastSupervisorHeartbeatAt,
      });

      // The supervisor owns the worker's stdout/stderr pipes. Once it is gone,
      // logging during graceful shutdown can block on the broken pipe and leave
      // the daemon orphaned, so supervisor loss is a hard process boundary.
      process.exit(0);
    };

    process.on("message", (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        (message as SupervisorHeartbeatMessage).type === "otto:supervisor-heartbeat"
      ) {
        lastSupervisorHeartbeatAt = Date.now();
      }
    });
    process.on("disconnect", () => exitAfterSupervisorLoss("ipc_disconnect_event"));

    const timer = setInterval(() => {
      const ipcConnected = typeof process.connected === "boolean" ? process.connected : true;
      const heartbeatExpired = Date.now() - lastSupervisorHeartbeatAt > 3500;
      const supervisorChanged = process.ppid !== supervisorPid;

      if (ipcConnected === false) {
        exitAfterSupervisorLoss("ipc_disconnected");
        return;
      }
      if (supervisorChanged) {
        exitAfterSupervisorLoss("supervisor_parent_pid_changed");
        return;
      }
      if (heartbeatExpired && !isPidAlive(supervisorPid)) {
        exitAfterSupervisorLoss("supervisor_pid_dead");
      }
    }, 1000);
    timer.unref();
  };

  installSupervisorLivenessGuard();

  try {
    daemon = await createOttoDaemon(
      {
        ...config,
        onLifecycleIntent: handleLifecycleIntent,
      },
      logger,
    );
  } catch (err) {
    logger.fatal({ err }, "Daemon bootstrap failed");
    throw err;
  }

  try {
    await daemon.start();
    const listenTarget = daemon.getListenTarget();
    const listen =
      listenTarget?.type === "tcp"
        ? `${listenTarget.host}:${listenTarget.port}`
        : listenTarget?.path;
    if (!listen) {
      throw new Error("Daemon did not expose a listen target after startup");
    }
    sendSupervisorLifecycleMessage({ type: "otto:ready", listen });
  } catch (err) {
    logger.fatal({ err }, "Daemon failed to start listening");
    if (isAddressInUseError(err)) {
      // Another daemon already holds the listen port. Restarting the worker can
      // never win against an occupied port, so exit with the fatal code that
      // tells the supervisor to stop instead of crash-looping (which is what
      // spawns rogue, port-squatting daemon processes).
      exitAfterPinoFlush(DAEMON_FATAL_EXIT_CODE);
      return;
    }
    throw err;
  }

  process.on("SIGTERM", () => beginShutdown("SIGTERM"));
  process.on("SIGINT", () => beginShutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — daemon crashing");
    exitAfterPinoFlush();
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled promise rejection — daemon crashing");
    exitAfterPinoFlush();
  });
}

// Give pino async streams a moment to flush the fatal log entry to daemon.log
// before the process exits. Without this, the last few entries that explain
// why the daemon crashed can be lost.
function exitAfterPinoFlush(code = 1): void {
  setTimeout(() => process.exit(code), 200);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  exitAfterPinoFlush();
});
