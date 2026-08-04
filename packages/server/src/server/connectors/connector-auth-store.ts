// The daemon's one connector-credential store, published here so the agent path
// can reach it without threading a store reference through the snapshot manager,
// the agent manager, and every provider constructor.
//
// Ambient at the edge, explicit at the call site: bootstrap installs the store
// once, and callers pass the result of getConnectorAuthStore() as an argument
// rather than reaching for a global mid-function. Tests install a memory store
// and get full isolation.
import type { ConnectorAuthState } from "@otto-code/protocol/provider-config";
import type { ConnectorAuthStore } from "./connector-oauth.js";

let installed: ConnectorAuthStore | null = null;

export function setConnectorAuthStore(store: ConnectorAuthStore | null): void {
  installed = store;
}

/**
 * The installed store, or undefined before bootstrap installs one. Undefined is
 * a legitimate state (unit tests, CLI paths that never touch connectors), so
 * callers treat it as "no OAuth attachment" rather than an error.
 */
export function getConnectorAuthStore(): ConnectorAuthStore | undefined {
  return installed ?? undefined;
}

/** In-memory store for tests. */
export function createMemoryConnectorAuthStore(
  seed?: Record<string, ConnectorAuthState>,
): ConnectorAuthStore {
  const entries = new Map<string, ConnectorAuthState>(Object.entries(seed ?? {}));
  return {
    read(connectorId) {
      return entries.get(connectorId);
    },
    write(connectorId, auth) {
      if (auth === null) {
        entries.delete(connectorId);
        return;
      }
      entries.set(connectorId, auth);
    },
  };
}
