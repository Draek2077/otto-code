import { useSessionStore } from "@/stores/session-store";

/**
 * The single detection point for the binary-write capability - bytes to a
 * workspace path, as opposed to the text write, which refuses binary targets
 * outright. There is no client-side substitute (the client never touches the
 * filesystem), so callers omit the affordance entirely rather than offering a
 * degraded one.
 *
 * COMPAT(binaryFileWrite): added in v0.7.6, drop the gate when daemon floor >= v0.7.6.
 */
export function useBinaryFileWriteFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.binaryFileWrite === true,
  );
}
