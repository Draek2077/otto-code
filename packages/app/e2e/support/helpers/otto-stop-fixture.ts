import { once } from "node:events";
import type { ChildProcess } from "node:child_process";
import { connectDaemonClient } from "./daemon-client-loader";
import { killProcessTree } from "./spawn-node";

interface ControlClient {
  connect(): Promise<void>;
  getLastServerInfoMessage(): { serverId: string } | null;
  shutdownServer(options: { timeout: number }): Promise<unknown>;
  close(): Promise<void>;
}

function exited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}
async function waitForFixtureExit(child: ChildProcess) {
  if (exited(child)) return true;
  const signal = AbortSignal.timeout(15000);
  try {
    await once(child, "exit", { signal });
    return true;
  } catch (error) {
    if (!signal.aborted) throw error;
    return exited(child);
  }
}

// Use the normal shutdown RPC on the unique loopback port allocated by this
// fixture. Verify its random server id and the captured child before sending.
export async function stopFixtureDaemon(child: ChildProcess, serverId: string, port: number) {
  if (process.platform !== "win32" || exited(child)) return killProcessTree(child);
  let client: ControlClient | undefined;
  let requested = false;
  try {
    client = await connectDaemonClient<ControlClient>({ clientIdPrefix: "fixture-shutdown", port });
    if (!exited(child) && client.getLastServerInfoMessage()?.serverId === serverId) {
      await client.shutdownServer({ timeout: 3000 });
      requested = true;
    }
  } catch {
    // A crashed worker can disappear before acknowledging. The captured child
    // below remains the sole fallback target.
  } finally {
    await client?.close();
  }
  if (requested && (await waitForFixtureExit(child))) return;
  await killProcessTree(child);
}
