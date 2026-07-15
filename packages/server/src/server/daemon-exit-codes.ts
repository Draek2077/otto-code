// Exit codes the daemon worker uses to tell the supervisor how to react.
//
// A normal non-zero exit (e.g. 1) means "crashed — try restarting", and the
// supervisor relaunches the worker. But some failures are permanent for the
// current launch and restarting only spins forever. The canonical case is
// EADDRINUSE: a stale daemon already holds the listen port, so every restart
// re-hits the same bind error. The worker exits with DAEMON_FATAL_EXIT_CODE for
// those, and the supervisor treats it as terminal (log and exit) instead of
// entering an infinite restart loop that piles up rogue processes.
//
// Chosen to not collide with 0 (success), 1 (generic crash), or signal-derived
// codes (128 + signal number). 78 mirrors sysexits.h EX_CONFIG.
export const DAEMON_FATAL_EXIT_CODE = 78;
