import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { terminateProcess } from "@getpaseo/plugin/server";
import { spawnProcess } from "../../../utils/spawn.js";
import type { PreviewManagerPorts, PreviewProcess } from "./manager.js";

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}
function groupSignal(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}
async function stopGroup(pid: number): Promise<void> {
  // Only a detached process created below supplies this group ID. Never infer a PID from a port.
  if (!groupSignal(pid, "SIGTERM")) return;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!groupSignal(pid, 0)) return;
    await delay(50);
  }
  groupSignal(pid, "SIGKILL");
}
export function probePreviewPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
async function spawnPreview(
  input: Parameters<PreviewManagerPorts["spawn"]>[0],
): Promise<PreviewProcess> {
  const child = spawnProcess(input.entry.runtimeExecutable, input.entry.runtimeArgs ?? [], {
    cwd: input.cwd,
    envOverlay: input.entry.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (text: string) => input.output("stdout", text));
  child.stderr?.on("data", (text: string) => input.output("stderr", text));
  // Attach close/error handling before awaiting spawn, including immediate failures.
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const pid = child.pid;
  if (!pid) throw new Error("Preview did not return an owned process identity.");
  let stopping: Promise<void> | undefined;
  const stop = async () => {
    if (process.platform !== "win32") {
      await stopGroup(pid);
      return;
    }
    await terminateProcess(child);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        exited,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Preview stop was not confirmed.")), 5000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return {
    pid,
    exited,
    stop: () => {
      stopping ??= stop().catch((error) => {
        stopping = undefined;
        throw error;
      });
      return stopping;
    },
  };
}
/** Construction is inert; only an authorized manager start invokes the process port. */
export function createPreviewProcessPorts(
  protectedPorts: ReadonlySet<number>,
): PreviewManagerPorts {
  return { protectedPorts, probe: probePreviewPort, spawn: spawnPreview };
}
