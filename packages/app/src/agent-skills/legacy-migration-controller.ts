import type { AgentSkillSelection } from "@otto-code/protocol/messages";

export interface LegacySelectionClient {
  importLegacyAgentSkillsSelection(selection: AgentSkillSelection): Promise<unknown>;
}

export interface LegacyMigrationPorts {
  getLocalStatus(): Promise<{
    status: string;
    desktopManaged: boolean;
    serverId: string;
    pid: number | null;
    error?: string | null;
  }>;
  getConnectedClient(serverId: string): LegacySelectionClient | null;
  read(): Promise<AgentSkillSelection | null>;
  remove(): Promise<void>;
  schedule(callback: () => void, delayMs: number): () => void;
  onError(error: unknown): void;
}

// COMPAT(desktopSkillSelectionMigration): added in v0.9.0; remove after 2027-03-05.
export function createLegacyMigrationController(ports: LegacyMigrationPorts): {
  refresh(): Promise<void>;
  dispose(): void;
} {
  let disposed = false;
  let complete = false;
  let inFlight: Promise<void> | null = null;
  let cancelRetry: (() => void) | null = null;
  let retryDelayMs = 1_000;
  let retryNeeded = false;
  let refreshRequested = false;

  async function attempt(): Promise<void> {
    const status = await ports.getLocalStatus();
    if (status.error) throw new Error(status.error);
    if (
      disposed ||
      status.status !== "running" ||
      !status.desktopManaged ||
      !status.serverId ||
      status.pid === null ||
      status.pid <= 0
    )
      return;
    const client = ports.getConnectedClient(status.serverId);
    if (!client) return;
    retryNeeded = true;
    const selection = await ports.read();
    // A disconnect or unmount during IPC must not send the local preference to
    // a stale client. A fresh attempt resolves local identity again.
    if (disposed || ports.getConnectedClient(status.serverId) !== client) return;
    // Absence resolves a fresh desktop's maintenance barrier too. Import-if-unset
    // preserves an explicit daemon choice, including a custom empty selection.
    await client.importLegacyAgentSkillsSelection(selection ?? { mode: "all" });
    if (selection) await ports.remove();
    complete = true;
  }

  function refresh(): Promise<void> {
    if (disposed || complete) return Promise.resolve();
    if (inFlight) {
      refreshRequested = true;
      return inFlight;
    }
    // Runtime notifications must not erase backoff after a recoverable failure.
    if (cancelRetry) return Promise.resolve();
    retryNeeded = false;
    refreshRequested = false;
    inFlight = attempt()
      .catch((error) => {
        retryNeeded = true;
        ports.onError(error);
      })
      .finally(() => {
        inFlight = null;
        if (disposed || complete) return;
        if (!retryNeeded) {
          // Do not lose a connection notification that arrived during status IPC.
          if (refreshRequested) void refresh();
          return;
        }
        cancelRetry = ports.schedule(() => {
          cancelRetry = null;
          void refresh();
        }, retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
      });
    return inFlight;
  }

  return {
    refresh,
    dispose() {
      disposed = true;
      cancelRetry?.();
      cancelRetry = null;
    },
  };
}
