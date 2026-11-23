// Otto 0.9 paired hosts through Otto's own relay. Otto 0.10 uses Paseo's relay,
// so saved relay endpoints on Otto's relay host move to Paseo's default relay.
// The daemon keeps its keypair, so existing pairings stay valid end to end.

import { DEFAULT_RELAY_ENDPOINT, parseHostPort } from "../daemon-endpoints.js";
import { OTTO_LEGACY_RELAY_HOST } from "./identity.js";

export function isOttoLegacyRelayEndpoint(endpoint: string): boolean {
  if (endpoint.trim().toLowerCase() === OTTO_LEGACY_RELAY_HOST) return true;
  try {
    return parseHostPort(endpoint).host.toLowerCase() === OTTO_LEGACY_RELAY_HOST;
  } catch {
    return false;
  }
}

interface StoredRelayConnection {
  type: "relay";
  relayEndpoint: string;
  useTls?: boolean;
}

interface StoredConnectionLike {
  type: string;
  id?: string;
}

const PASEO_RELAY_CONNECTION_ID = `relay:wss:${DEFAULT_RELAY_ENDPOINT}`;

function isRelayConnection(
  connection: StoredConnectionLike,
): connection is StoredConnectionLike & StoredRelayConnection {
  return connection.type === "relay";
}

/** Moves a stored host profile's Otto-relay connections to Paseo's relay. */
export function migrateOttoLegacyRelayProfile<
  T extends { connections: StoredConnectionLike[]; preferredConnectionId?: string | null },
>(record: T): T {
  let migratedPreferred = false;
  const connections = record.connections.map((connection) => {
    if (!isRelayConnection(connection) || !isOttoLegacyRelayEndpoint(connection.relayEndpoint)) {
      return connection;
    }
    if (connection.id !== undefined && connection.id === record.preferredConnectionId) {
      migratedPreferred = true;
    }
    return {
      ...connection,
      ...(connection.id !== undefined ? { id: PASEO_RELAY_CONNECTION_ID } : {}),
      relayEndpoint: DEFAULT_RELAY_ENDPOINT,
      useTls: true,
    };
  });
  if (connections.every((connection, index) => connection === record.connections[index])) {
    return record;
  }

  const seenRelay = new Set<string>();
  const deduped = connections.filter((connection) => {
    if (!isRelayConnection(connection)) return true;
    const key = `${connection.relayEndpoint}|${connection.useTls === true}`;
    if (seenRelay.has(key)) return false;
    seenRelay.add(key);
    return true;
  });
  return {
    ...record,
    connections: deduped,
    ...(migratedPreferred ? { preferredConnectionId: PASEO_RELAY_CONNECTION_ID } : {}),
  };
}
