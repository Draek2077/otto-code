"use strict";
// DIAG(windows-fork-crash): temporary instrumentation for the Windows
// server-tests worker crashes ("[vitest-pool]: Worker forks emitted error"
// with every test passing). Loaded through NODE_OPTIONS --require into every
// node process of the test run - the vitest main process, every pool fork,
// and every child the tests spawn. Inert unless OTTO_KILL_DIAG_FILE is set.
//
// One JSON line per event is appended to OTTO_KILL_DIAG_FILE:
//   boot      a node process started (pid, ppid, argv hint, vitest pool id)
//   exit      that process left through JS. A fork killed with
//             TerminateProcess (taskkill /F) never writes one, which is what
//             marks the victims.
//   taskkill  something spawned taskkill: full command line plus JS stack.
//   kill      process.kill() with a real signal at a foreign pid, plus stack.
//
// Matching taskkill/kill target pids against boot records that have no exit
// record names the killer call site and the victim fork in one run.

const OUT = process.env.OTTO_KILL_DIAG_FILE;
if (OUT) {
  const fs = require("node:fs");

  const record = (ev, extra) => {
    try {
      fs.appendFileSync(
        OUT,
        `${JSON.stringify({ t: Date.now(), pid: process.pid, ppid: process.ppid, ev, ...extra })}\n`,
      );
    } catch {
      // Diagnostics must never break the run.
    }
  };

  record("boot", {
    argv: process.argv.slice(1, 3).map((a) => String(a).slice(-96)),
    pool: process.env.VITEST_POOL_ID ?? null,
  });
  process.on("exit", (code) => record("exit", { code }));

  const cp = require("node:child_process");
  const { promisify } = require("node:util");
  const flatten = (command, args) =>
    [command, ...(Array.isArray(args) ? args : [])].map(String).join(" ");
  const wrap = (name) => {
    const original = cp[name];
    if (typeof original !== "function") {
      return;
    }
    const wrapped = function (...callArgs) {
      try {
        const cmd = flatten(callArgs[0], callArgs[1]);
        if (/taskkill/i.test(cmd)) {
          record("taskkill", { via: name, cmd, stack: new Error("taskkill").stack });
        }
      } catch {
        // Diagnostics must never break the run.
      }
      return original.apply(this, callArgs);
    };
    // exec/execFile carry a util.promisify.custom implementation that
    // resolves { stdout, stderr } instead of the generic single-arg
    // fallback. A plain reassignment here drops that symbol, so every
    // promisify(execFile)/promisify(exec) call in the app under test
    // silently degrades to resolving just the raw stdout string - exactly
    // the "stdout is undefined" failures this file was written to explain.
    if (original[promisify.custom]) {
      wrapped[promisify.custom] = original[promisify.custom];
    }
    cp[name] = wrapped;
  };
  for (const name of ["spawn", "exec", "execFile", "spawnSync", "execSync", "execFileSync"]) {
    wrap(name);
  }

  const originalKill = process.kill.bind(process);
  process.kill = (pid, signal) => {
    if (signal !== 0 && pid !== process.pid) {
      record("kill", { target: pid, signal: signal ?? "SIGTERM", stack: new Error("kill").stack });
    }
    return originalKill(pid, signal);
  };
}
