/**
 * Relay connection types and interfaces.
 *
 * The relay bridges two WebSocket connections:
 * - Server (daemon): The Otto server connecting to the relay
 * - Client (app): The mobile/web app connecting to the relay
 *
 * Messages are forwarded bidirectionally without modification.
 */

export type ConnectionRole = "server" | "client";

export interface RelaySessionAttachment {
  serverId: string;
  role: ConnectionRole;
  /**
   * Relay protocol version carried by this socket.
   * v1: single server/client socket pair
   * v2: control + per-client data sockets
   */
  version?: "1" | "2";
  /**
   * Unique id for the connection. Allows the daemon to create an
   * independent socket + E2EE channel per connected connection.
   */
  connectionId?: string | null;
  createdAt: number;
  /**
   * Ephemeral per-socket message allowance. This travels with Cloudflare's
   * hibernatable WebSocket attachment only; it is neither user identity nor
   * relay history and disappears when the socket closes.
   */
  rateWindowStartedAt?: number;
  rateWindowMessageCount?: number;
}
