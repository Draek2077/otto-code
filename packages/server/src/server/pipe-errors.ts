/**
 * Which failures mean "the thing we were writing to is gone" rather than "our logic is wrong".
 *
 * The daemon supervises subprocesses that are allowed to die at any moment - language servers,
 * the .NET solution sidecar, terminals - and every one of them leaves a destroyed pipe behind
 * when it goes. A write already in flight then rejects, and an unhandled rejection was fatal:
 * a crashing csharp-ls took the whole daemon down, every agent and terminal with it, in a
 * restart loop.
 *
 * Deliberately a short, closed list. The point is to stop a dead subprocess from being fatal,
 * not to make the daemon survive its own bugs - anything not named here still crashes, loudly.
 */
const SURVIVABLE_PIPE_ERROR_CODES: ReadonlySet<string> = new Set([
  "EPIPE",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END",
]);

export function isSurvivablePipeError(reason: unknown): boolean {
  if (typeof reason !== "object" || reason === null) {
    return false;
  }
  const code = (reason as { code?: unknown }).code;
  return typeof code === "string" && SURVIVABLE_PIPE_ERROR_CODES.has(code);
}
